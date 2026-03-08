import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listFilesRec } from "./util/fs.js";
import { sha256 } from "./util/hash.js";
import { green, red, yellow, bold, dim } from "./util/color.js";
import { evaluatePolicy } from "./policy.js";
import { loadManifest } from "./gen.js";
import { listPlaywrightTypes, listK6Types } from "./verification-registry.js";

export function loadLock(cwd) {
  const lockPath = path.join(cwd, ".gen", "vp.lock.json");
  if (!fs.existsSync(lockPath)) throw new Error("Missing .gen/vp.lock.json. Run shipflow gen.");
  return JSON.parse(fs.readFileSync(lockPath, "utf-8"));
}

export function verifyLock(cwd, lock) {
  const vpDir = path.join(cwd, "vp");
  const files = listFilesRec(vpDir).filter(p => !p.includes(`${path.sep}.DS_Store`));
  const items = files.map(p => {
    const rel = path.relative(cwd, p).replaceAll("\\", "/");
    const buf = fs.readFileSync(p);
    return { path: rel, sha256: sha256(buf) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const vpSha = sha256(Buffer.from(JSON.stringify(items)));
  if (vpSha !== lock.vp_sha256) throw new Error("Verification pack changed since last generation. Run shipflow gen.");
}

export function parseSummary(output) {
  const passed = output.match(/(\d+)\s+passed/);
  const failed = output.match(/(\d+)\s+failed/);
  const skipped = output.match(/(\d+)\s+skipped/);
  return {
    passed: passed ? parseInt(passed[1], 10) : 0,
    failed: failed ? parseInt(failed[1], 10) : 0,
    skipped: skipped ? parseInt(skipped[1], 10) : 0,
  };
}

function ensureEvidence(cwd) {
  const evid = path.join(cwd, "evidence");
  fs.mkdirSync(evid, { recursive: true });
  fs.mkdirSync(path.join(evid, "artifacts"), { recursive: true });
  return evid;
}

function writeEvidence(evid, file, data) {
  fs.writeFileSync(path.join(evid, file), JSON.stringify(data, null, 2));
}

function writeArtifact(evid, file, content) {
  fs.writeFileSync(path.join(evid, "artifacts", file), content);
}

function manifestFilesForType(cwd, manifest, entry) {
  const files = manifest?.outputs?.[entry.id]?.files;
  if (Array.isArray(files) && files.length > 0) return files;

  const dir = path.join(cwd, ".gen", entry.output_dir);
  if (!fs.existsSync(dir)) return [];
  const prefix = `vp_${entry.id}_`;
  return fs.readdirSync(dir)
    .filter(file => file.startsWith(prefix))
    .map(file => path.relative(cwd, path.join(dir, file)).replaceAll("\\", "/"));
}

export function collectGeneratedFilesByType(cwd, manifest, entry) {
  return manifestFilesForType(cwd, manifest, entry);
}

export function collectGeneratedChecksByType(cwd, manifest, entry) {
  const checks = manifest?.outputs?.[entry.id]?.checks;
  if (Array.isArray(checks) && checks.length > 0) return checks;
  return collectGeneratedFilesByType(cwd, manifest, entry).map(file => ({
    id: path.basename(file, path.extname(file)),
    title: path.basename(file),
    severity: "blocker",
    file,
  }));
}

function policyEvidence(lock) {
  return {
    version: 1,
    kind: "policy",
    ok: true,
    skipped: true,
    reason: "no policy files",
    lock_vp_sha256: lock.vp_sha256,
  };
}

function runPolicyGate({ cwd, lock, evid }) {
  const policyDir = path.join(cwd, "vp", "policy");
  if (!fs.existsSync(policyDir) || !fs.readdirSync(policyDir).some(f => f.endsWith(".rego"))) {
    const result = policyEvidence(lock);
    writeEvidence(evid, "policy.json", result);
    return result;
  }

  console.log(bold("\nPolicy evaluation:"));
  const policy = evaluatePolicy({ cwd, lock });
  const result = {
    version: 1,
    kind: "policy",
    started_at: new Date().toISOString(),
    ok: policy.ok,
    skipped: false,
    lock_vp_sha256: lock.vp_sha256,
  };
  writeEvidence(evid, "policy.json", result);
  return result;
}

function emptyGroupEvidence(entry, reason) {
  return {
    version: 1,
    kind: entry.id,
    label: entry.label,
    ok: true,
    skipped: true,
    reason,
    passed: 0,
    failed: 0,
    skipped_count: 0,
    advisory_failed: 0,
    files: [],
    checks: [],
  };
}

function groupBySeverity(checks) {
  return {
    blocker: checks.filter(check => check.severity !== "warn"),
    warn: checks.filter(check => check.severity === "warn"),
  };
}

function summarizeGroups(groups) {
  const totals = {
    passed: 0,
    failed: 0,
    skipped: 0,
    advisory_failed: 0,
  };
  for (const group of groups) {
    totals.passed += group.passed || 0;
    totals.failed += group.failed || 0;
    totals.skipped += group.skipped_count || 0;
    totals.advisory_failed += group.advisory_failed || 0;
    if (group.skipped) totals.skipped += 1;
  }
  return totals;
}

function runPlaywrightBatch(cwd, files) {
  const t0 = Date.now();
  const res = spawnSync("npx", ["playwright", "test", "--reporter=list", ...files], { stdio: "pipe", cwd });
  const output = (res.stdout?.toString() || "") + (res.stderr?.toString() || "");
  const summary = parseSummary(output);
  return {
    ok: res.status === 0,
    exit_code: res.status ?? 1,
    duration_ms: Date.now() - t0,
    output,
    passed: summary.passed,
    failed: summary.failed,
    skipped_count: summary.skipped,
  };
}

function runPlaywrightGroup({ cwd, evid, entry, checks, capture }) {
  if (checks.length === 0) {
    const result = emptyGroupEvidence(entry, "no generated tests");
    writeEvidence(evid, entry.evidence_file, result);
    return { result, output: "" };
  }

  console.log(bold(`\n${entry.label}: running ${checks.length} generated test(s)...`));
  const t0 = Date.now();
  const grouped = groupBySeverity(checks);
  const batches = [];
  let blockerOk = true;
  let advisoryFailed = 0;
  let combinedOutput = "";

  for (const severity of ["blocker", "warn"]) {
    const batchChecks = grouped[severity];
    if (batchChecks.length === 0) continue;
    const files = batchChecks.map(check => check.file);
    const batch = runPlaywrightBatch(cwd, files);
    combinedOutput += batch.output;
    writeArtifact(evid, `${entry.id}-${severity}.log`, batch.output);
    if (!capture) process.stdout.write(batch.output);
    if (severity === "blocker" && !batch.ok) blockerOk = false;
    if (severity === "warn" && !batch.ok) advisoryFailed += 1;
    batches.push({
      severity,
      ok: batch.ok,
      exit_code: batch.exit_code,
      duration_ms: batch.duration_ms,
      passed: batch.passed,
      failed: batch.failed,
      skipped_count: batch.skipped_count,
      files,
    });
  }

  const summary = summarizeGroups(batches);
  const result = {
    version: 1,
    kind: entry.id,
    label: entry.label,
    started_at: new Date(t0).toISOString(),
    duration_ms: Date.now() - t0,
    exit_code: blockerOk ? 0 : 1,
    ok: blockerOk,
    skipped: false,
    passed: summary.passed,
    failed: summary.failed,
    skipped_count: summary.skipped,
    advisory_failed: advisoryFailed,
    files: checks.map(check => check.file),
    checks,
    batches,
  };
  writeEvidence(evid, entry.evidence_file, result);
  return { result, output: combinedOutput };
}

function runK6Group({ cwd, evid, entry, checks, verbose }) {
  if (checks.length === 0) {
    const result = emptyGroupEvidence(entry, "no generated scripts");
    writeEvidence(evid, entry.evidence_file, result);
    return { result, output: "" };
  }

  const k6Check = spawnSync("k6", ["version"], { stdio: "pipe", cwd });
  if (k6Check.status !== 0) {
    const result = {
      ...emptyGroupEvidence(entry, "k6 not installed"),
      files: checks.map(check => check.file),
      checks,
    };
    writeEvidence(evid, entry.evidence_file, result);
    if (verbose) console.log(dim("  k6 not found, skipping performance checks"));
    return { result, output: "" };
  }

  console.log(bold(`\n${entry.label}: running ${checks.length} k6 script(s)...`));
  const t0 = Date.now();
  let blockerOk = true;
  let advisoryFailed = 0;
  let combinedOutput = "";
  const scripts = [];

  for (const check of checks) {
    const r = spawnSync("k6", ["run", check.file], { stdio: "pipe", cwd });
    const output = (r.stdout?.toString() || "") + (r.stderr?.toString() || "");
    combinedOutput += output;
    writeArtifact(evid, `${path.basename(check.file)}.log`, output);
    scripts.push({
      file: check.file,
      id: check.id,
      severity: check.severity,
      ok: r.status === 0,
      exit_code: r.status ?? 1,
    });
    if (r.status !== 0) {
      if (check.severity === "warn") {
        advisoryFailed += 1;
        console.log(yellow(`  ! ${path.basename(check.file)} (warn)`));
      } else {
        blockerOk = false;
        console.log(red(`  ✗ ${path.basename(check.file)}`));
      }
      if (verbose) process.stdout.write(output);
    } else {
      console.log(green(`  ✓ ${path.basename(check.file)}`));
    }
  }

  const result = {
    version: 1,
    kind: entry.id,
    label: entry.label,
    started_at: new Date(t0).toISOString(),
    duration_ms: Date.now() - t0,
    exit_code: blockerOk ? 0 : 1,
    ok: blockerOk,
    skipped: false,
    advisory_failed: advisoryFailed,
    files: checks.map(check => check.file),
    checks,
    scripts,
  };
  writeEvidence(evid, entry.evidence_file, result);
  return { result, output: combinedOutput };
}

export async function verify({ cwd, capture = false, verbose = false }) {
  const evid = ensureEvidence(cwd);
  const manifest = loadManifest(cwd);
  const lock = loadLock(cwd);
  verifyLock(cwd, lock);

  const startedAt = Date.now();
  const allOutputs = [];
  const groups = [];

  const policy = runPolicyGate({ cwd, lock, evid });
  if (!policy.ok) {
    console.log(red("\nPolicy check FAILED. Fix policy violations before verifying.\n"));
    const result = {
      version: 2,
      started_at: new Date(startedAt).toISOString(),
      duration_ms: Date.now() - startedAt,
      exit_code: 3,
      ok: false,
      passed: 0,
      failed: 0,
      advisory_failed: 0,
      skipped: 0,
      groups: [],
    };
    writeEvidence(evid, "run.json", result);
    return { exitCode: 3, output: null };
  }

  for (const entry of listPlaywrightTypes()) {
    const checks = collectGeneratedChecksByType(cwd, manifest, entry);
    const group = runPlaywrightGroup({ cwd, evid, entry, checks, capture });
    groups.push(group.result);
    if (group.output) allOutputs.push(group.output);
  }

  for (const entry of listK6Types()) {
    const checks = collectGeneratedChecksByType(cwd, manifest, entry);
    const group = runK6Group({ cwd, evid, entry, checks, verbose });
    groups.push(group.result);
    if (group.output) allOutputs.push(group.output);
  }

  const summary = summarizeGroups(groups);
  const ok = groups.every(group => group.ok);
  const exitCode = ok ? 0 : 1;

  const parts = [];
  if (summary.passed > 0) parts.push(green(`${summary.passed} passed`));
  if (summary.failed > 0) parts.push(red(`${summary.failed} failed`));
  if (summary.advisory_failed > 0) parts.push(yellow(`${summary.advisory_failed} advisory failed`));
  if (summary.skipped > 0) parts.push(yellow(`${summary.skipped} skipped`));
  if (parts.length > 0) {
    console.log(`\n${bold("Summary:")} ${parts.join(", ")} ${dim(`(${Date.now() - startedAt}ms)`)}`);
  }

  const perGroup = groups
    .filter(group => !group.skipped || group.files.length > 0)
    .map(group => `${group.label}: ${group.ok ? "PASS" : "FAIL"}${group.advisory_failed ? ` (+${group.advisory_failed} warn)` : ""}${group.skipped ? " (skipped)" : ""}`);
  if (perGroup.length > 0) console.log(dim(`  ${perGroup.join(" | ")}`));

  if (ok) {
    console.log(green(bold("\n✓ All blocker verifications passed.\n")));
  } else {
    console.log(red(bold("\n✗ Blocker verifications failed.\n")));
  }

  const result = {
    version: 2,
    started_at: new Date(startedAt).toISOString(),
    duration_ms: Date.now() - startedAt,
    exit_code: exitCode,
    ok,
    passed: summary.passed,
    failed: summary.failed,
    advisory_failed: summary.advisory_failed,
    skipped: summary.skipped,
    groups,
  };
  writeEvidence(evid, "run.json", result);
  return { exitCode, output: allOutputs.join("\n") };
}
