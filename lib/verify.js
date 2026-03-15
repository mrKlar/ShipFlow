import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { green, red, yellow, bold, dim } from "./util/color.js";
import { evaluatePolicy } from "./policy.js";
import { loadManifest } from "./gen.js";
import { listPlaywrightTypes, listK6Types, listCucumberTypes, listTechnicalTypes, listDomainTypes } from "./verification-registry.js";
import { collectGeneratedArtifactItems, collectVerificationPackItems, hashLockItems } from "./util/verification-lock.js";
import { buildRuntimeEnv, runtimeCommandExists } from "./util/runtime-env.js";

function generatedPlaywrightConfigPath(cwd) {
  const rel = ".gen/playwright.config.mjs";
  const full = path.join(cwd, rel);
  return fs.existsSync(full) ? rel : null;
}

function generatedPlaywrightRuntime(cwd) {
  const rel = generatedPlaywrightConfigPath(cwd);
  if (!rel) return null;
  const content = fs.readFileSync(path.join(cwd, rel), "utf-8");
  const baseUrlMatch = content.match(/const baseURL = process\.env\.SHIPFLOW_BASE_URL \|\| "([^"]+)";/);
  const commandMatch = content.match(/const webServerCommand = process\.env\.SHIPFLOW_WEB_SERVER_COMMAND \|\| "([^"]+)";/);
  const shouldStartMatch = content.match(/const shouldStartWebServer = (true|false)\s*\|\|/);
  const gatedShouldStartMatch = content.match(/const shouldStartWebServer = !hasExternalWebServer && \((true|false)\s*\|\|/);
  const shouldStart = Boolean(process.env.SHIPFLOW_WEB_SERVER_COMMAND)
    || shouldStartMatch?.[1] === "true"
    || gatedShouldStartMatch?.[1] === "true";
  return {
    base_url: process.env.SHIPFLOW_BASE_URL || baseUrlMatch?.[1] || null,
    command: process.env.SHIPFLOW_WEB_SERVER_COMMAND || commandMatch?.[1] || null,
    should_start: shouldStart,
    pid_file: path.join(cwd, ".gen", "managed-runtime.pid"),
  };
}

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function urlResponds(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return res.ok || (res.status >= 300 && res.status < 500);
  } catch {
    return false;
  }
}

async function waitForUrl(url, child, logs, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await urlResponds(url)) return { ok: true, output: logs.join("") };
    if (child && child.exitCode !== null) {
      return { ok: false, output: logs.join("") };
    }
    await waitMs(250);
  }
  return { ok: false, output: logs.join("") };
}

function readManagedServerPid(server) {
  if (server?.pid_file && fs.existsSync(server.pid_file)) {
    const raw = fs.readFileSync(server.pid_file, "utf-8").trim();
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (server?.child?.pid) return server.child.pid;
  return null;
}

function listeningPidForUrl(cwd, url) {
  if (!url || !runtimeCommandExists(cwd, "ss")) return null;
  let port = null;
  try {
    const parsedUrl = new URL(url);
    port = parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80");
  } catch {
    return null;
  }
  if (!port) return null;
  const result = spawnSync("ss", ["-ltnp"], {
    stdio: "pipe",
    cwd,
    env: buildRuntimeEnv(cwd),
    encoding: "utf-8",
  });
  if (result.status !== 0) return null;
  const lines = String(result.stdout || "").split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes(`:${port}`)) continue;
    const match = line.match(/pid=(\d+)/);
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function processGroupLooksAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code !== "ESRCH") return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function clearManagedServerPidFile(server) {
  if (server?.pid_file && fs.existsSync(server.pid_file)) {
    fs.rmSync(server.pid_file, { force: true });
  }
}

async function stopManagedServer(server) {
  const processGroupId = readManagedServerPid(server);
  if (!processGroupId && !server?.child) return;
  if (server?.child?.exitCode !== null && !server?.pid_file) return;
  try {
    if (processGroupId) process.kill(-processGroupId, "SIGTERM");
    else server.child?.kill("SIGTERM");
  } catch (error) {
    if (error?.code === "ESRCH" && processGroupId) {
      try {
        process.kill(processGroupId, "SIGTERM");
      } catch (innerError) {
        if (innerError?.code !== "ESRCH") throw innerError;
      }
    } else if (error?.code !== "ESRCH") {
      throw error;
    }
  }
  await Promise.race([
    server?.child ? new Promise(resolve => server.child.once("exit", resolve)) : Promise.resolve(),
    waitMs(1000),
  ]);
  if (server?.base_url) {
    const stopped = !(await urlResponds(server.base_url));
    if (stopped) {
      clearManagedServerPidFile(server);
      return;
    }
  } else if (server?.child?.exitCode !== null) {
    clearManagedServerPidFile(server);
    return;
  }
  try {
    if (processGroupId) process.kill(-processGroupId, "SIGKILL");
    else server.child?.kill("SIGKILL");
  } catch (error) {
    if (error?.code === "ESRCH" && processGroupId) {
      try {
        process.kill(processGroupId, "SIGKILL");
      } catch (innerError) {
        if (innerError?.code !== "ESRCH") throw innerError;
      }
    } else if (error?.code !== "ESRCH") {
      throw error;
    }
  }
  await Promise.race([
    server?.child ? new Promise(resolve => server.child.once("exit", resolve)) : Promise.resolve(),
    waitMs(1000),
  ]);
  clearManagedServerPidFile(server);
}

async function ownedManagedServerState(runtime) {
  if (!runtime?.pid_file || !fs.existsSync(runtime.pid_file)) {
    return { owned: false, pid: null, reachable: await urlResponds(runtime?.base_url) };
  }
  const raw = fs.readFileSync(runtime.pid_file, "utf-8").trim();
  const pid = Number.parseInt(raw, 10);
  if (!processGroupLooksAlive(pid)) {
    clearManagedServerPidFile(runtime);
    return { owned: false, pid: null, reachable: await urlResponds(runtime?.base_url) };
  }
  const reachable = await urlResponds(runtime.base_url);
  if (!reachable) {
    clearManagedServerPidFile(runtime);
    return { owned: false, pid: null, reachable: false };
  }
  return { owned: true, pid, reachable: true };
}

async function ensureManagedWebServer(cwd) {
  const runtime = generatedPlaywrightRuntime(cwd);
  if (!runtime?.should_start || !runtime.base_url || !runtime.command) {
    return { ok: true, output: "", server: null, runtime, trace: ["runtime: disabled"] };
  }

  const ownedServer = await ownedManagedServerState(runtime);
  if (ownedServer.owned) {
    return {
      ok: true,
      output: "",
      trace: [`runtime: reusing owned server at ${runtime.base_url} (pid-group ${ownedServer.pid})`],
      server: {
        child: null,
        pid_file: runtime.pid_file,
        base_url: runtime.base_url,
        command: runtime.command,
      },
      runtime,
    };
  }

  if (ownedServer.reachable) {
    return {
      ok: false,
      output: `ShipFlow verify: local web runtime ${runtime.base_url} is already reachable but is not owned by ShipFlow. Stop the external server and rerun verify.`,
      server: null,
      runtime,
      trace: [`runtime: found reachable external server at ${runtime.base_url} without owned pid file`],
    };
  }

  const started = await startManagedWebServer(cwd, runtime);
  return {
    ...started,
    runtime,
    trace: [
      `runtime: starting managed server at ${runtime.base_url} with command ${runtime.command}`,
      ...(started.trace || []),
    ],
  };
}

async function startManagedWebServer(cwd, runtime) {
  const logs = [];
  const pidFile = runtime.pid_file || path.join(cwd, ".gen", "managed-runtime.pid");
  const child = spawn(process.execPath, ["-e", MANAGED_RUNTIME_LAUNCHER], {
    cwd,
    detached: true,
    env: buildRuntimeEnv(cwd, process.env, {
      SHIPFLOW_MANAGED_RUNTIME_COMMAND: runtime.command,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(child.pid));
  child.stdout.on("data", chunk => logs.push(chunk.toString()));
  child.stderr.on("data", chunk => logs.push(chunk.toString()));

  const ready = await waitForUrl(runtime.base_url, child, logs);
  if (!ready.ok) {
    await stopManagedServer({ child, pid_file: pidFile, base_url: runtime.base_url });
    return {
      ok: false,
      output: `ShipFlow verify: failed to start the managed local web runtime at ${runtime.base_url}\n${ready.output}`.trim(),
      server: null,
      trace: [`runtime: failed to start managed server (pid-group ${child.pid ?? "unknown"})`],
    };
  }

  return {
    ok: true,
    output: "",
    trace: [`runtime: managed server ready at ${runtime.base_url} (pid-group ${child.pid})`, `runtime: pid file ${pidFile}`],
    server: {
      child,
      pid_file: pidFile,
      base_url: runtime.base_url,
      command: runtime.command,
    },
  };
}

async function ensureManagedServerReady(cwd, managedServer) {
  if (!managedServer?.ok) return managedServer;
  const runtime = managedServer.runtime;
  if (!runtime?.should_start || !runtime.base_url || !runtime.command) return managedServer;
  const ownedServer = await ownedManagedServerState(runtime);
  if (ownedServer.owned) {
    managedServer.trace?.push(`runtime: confirmed owned server at ${runtime.base_url} (pid-group ${ownedServer.pid})`);
    managedServer.server = {
      child: managedServer.server?.child || null,
      pid_file: runtime.pid_file,
      base_url: runtime.base_url,
      command: runtime.command,
    };
    return managedServer;
  }
  if (ownedServer.reachable) {
    const adoptedPid = listeningPidForUrl(cwd, runtime.base_url);
    if (Number.isFinite(adoptedPid) && adoptedPid > 0) {
      fs.mkdirSync(path.dirname(runtime.pid_file), { recursive: true });
      fs.writeFileSync(runtime.pid_file, String(adoptedPid));
      managedServer.trace?.push(`runtime: adopted reachable server at ${runtime.base_url} via listener pid ${adoptedPid}`);
      managedServer.server = {
        child: managedServer.server?.child || null,
        pid_file: runtime.pid_file,
        base_url: runtime.base_url,
        command: runtime.command,
      };
      return managedServer;
    }
    managedServer.trace?.push(`runtime: reachable server at ${runtime.base_url} is no longer owned; pid file missing or stale`);
    managedServer.ok = false;
    managedServer.output = `ShipFlow verify: local web runtime ${runtime.base_url} is already reachable but is not owned by ShipFlow. Stop the external server and rerun verify.`;
    managedServer.server = null;
    return managedServer;
  }

  await stopManagedServer(managedServer.server).catch(() => {});
  const restarted = await startManagedWebServer(cwd, runtime);
  managedServer.trace?.push(`runtime: restarted managed server for ${runtime.base_url}`);
  for (const line of restarted.trace || []) managedServer.trace?.push(line);
  managedServer.ok = restarted.ok;
  managedServer.output = restarted.output;
  managedServer.server = restarted.server;
  return managedServer;
}

export function loadLock(cwd) {
  const lockPath = path.join(cwd, ".gen", "vp.lock.json");
  if (!fs.existsSync(lockPath)) throw new Error("Missing .gen/vp.lock.json. Run shipflow gen.");
  return JSON.parse(fs.readFileSync(lockPath, "utf-8"));
}

export function verifyLock(cwd, lock) {
  const vpSha = hashLockItems(collectVerificationPackItems(cwd));
  if (vpSha !== lock.vp_sha256) throw new Error("Verification pack changed since last generation. Run shipflow gen.");
  if (typeof lock.generated_sha256 !== "string" || !Array.isArray(lock.generated_files)) {
    throw new Error("Lock does not cover generated artifacts. Run shipflow gen.");
  }
  const generatedSha = hashLockItems(collectGeneratedArtifactItems(cwd));
  if (generatedSha !== lock.generated_sha256) {
    throw new Error("Generated artifacts changed since last generation. Run shipflow gen.");
  }
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

const MANAGED_RUNTIME_LAUNCHER = [
  'import { spawn } from "node:child_process";',
  'const child = spawn(process.env.SHIPFLOW_MANAGED_RUNTIME_COMMAND, {',
  '  shell: true,',
  '  stdio: "inherit",',
  '  env: { ...process.env },',
  "});",
  'child.on("exit", code => process.exit(code ?? 0));',
].join("\n");

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

function buildManagedRuntimeEnv(cwd, managedServer, extraEnv = {}) {
  const pid = readManagedServerPid(managedServer);
  return buildRuntimeEnv(cwd, process.env, {
    SHIPFLOW_EVIDENCE_DIR: path.join(cwd, "evidence"),
    SHIPFLOW_EXTERNAL_WEB_SERVER: managedServer?.runtime?.should_start ? "1" : "",
    SHIPFLOW_MANAGED_SERVER_PID: pid ? String(pid) : "",
    SHIPFLOW_MANAGED_SERVER_PID_FILE: managedServer?.server?.pid_file || "",
    SHIPFLOW_BASE_URL: managedServer?.runtime?.base_url || process.env.SHIPFLOW_BASE_URL || "",
    SHIPFLOW_WEB_SERVER_COMMAND: managedServer?.runtime?.command || process.env.SHIPFLOW_WEB_SERVER_COMMAND || "",
    ...extraEnv,
  });
}

async function runPlaywrightBatch(cwd, files, managedServer, extraEnv = {}) {
  const t0 = Date.now();
  const readyManagedServer = await ensureManagedServerReady(cwd, managedServer);
  if (!readyManagedServer.ok) {
    return {
      ok: false,
      exit_code: 1,
      duration_ms: Date.now() - t0,
      output: readyManagedServer.output,
      passed: 0,
      failed: 1,
      skipped_count: 0,
    };
  }
  const config = generatedPlaywrightConfigPath(cwd);
  const args = ["playwright", "test"];
  if (config) args.push("--config", config);
  args.push("--reporter=list", ...files);
  const res = spawnSync("npx", args, {
    stdio: "pipe",
    cwd,
    env: buildManagedRuntimeEnv(cwd, readyManagedServer, extraEnv),
  });
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

async function runCucumberBatch(cwd, featureFiles, stepFiles, managedServer) {
  const t0 = Date.now();
  const readyManagedServer = await ensureManagedServerReady(cwd, managedServer);
  if (!readyManagedServer.ok) {
    return {
      ok: false,
      exit_code: 1,
      duration_ms: Date.now() - t0,
      output: readyManagedServer.output,
      passed: 0,
      failed: 1,
      skipped_count: 0,
    };
  }
  const args = ["cucumber-js", "--format", "summary"];
  for (const file of stepFiles) {
    args.push("--import", file);
  }
  args.push(...featureFiles);
  try {
    const res = spawnSync("npx", args, {
      stdio: "pipe",
      cwd,
      env: buildManagedRuntimeEnv(cwd, readyManagedServer),
    });
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
  } finally {
    // Shared managed server is stopped by verify() after all groups finish.
  }
}

async function runPlaywrightGroup({ cwd, evid, entry, checks, capture, managedServer }) {
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
    const batch = await runPlaywrightBatch(cwd, files, managedServer);
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

async function runCucumberGroup({ cwd, evid, entry, checks, capture, managedServer }) {
  if (checks.length === 0) {
    const result = emptyGroupEvidence(entry, "no generated features");
    writeEvidence(evid, entry.evidence_file, result);
    return { result, output: "" };
  }

  console.log(bold(`\n${entry.label}: running ${checks.length} generated feature(s)...`));
  const t0 = Date.now();
  const grouped = groupBySeverity(checks);
  const batches = [];
  let blockerOk = true;
  let advisoryFailed = 0;
  let combinedOutput = "";

  for (const severity of ["blocker", "warn"]) {
    const batchChecks = grouped[severity];
    if (batchChecks.length === 0) continue;
    let severityOutput = "";
    for (const check of batchChecks) {
      const featureFiles = [check.file];
      const stepFiles = [...new Set(check.companion_files || [])];
      const batch = await runCucumberBatch(cwd, featureFiles, stepFiles, managedServer);
      combinedOutput += batch.output;
      severityOutput += batch.output;
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
        files: [...featureFiles, ...stepFiles],
      });
    }
    writeArtifact(evid, `${entry.id}-${severity}.log`, severityOutput);
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
    files: checks.flatMap(check => [check.file, ...(check.companion_files || [])]).filter(Boolean),
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

  if (!runtimeCommandExists(cwd, "k6")) {
    const result = {
      version: 1,
      kind: entry.id,
      label: entry.label,
      ok: false,
      skipped: false,
      reason: "k6 not installed",
      exit_code: 1,
      passed: 0,
      failed: checks.filter(check => check.severity !== "warn").length,
      skipped_count: 0,
      advisory_failed: checks.filter(check => check.severity === "warn").length,
      files: checks.map(check => check.file),
      checks,
    };
    writeEvidence(evid, entry.evidence_file, result);
    console.log(red("  k6 not found, performance checks cannot run"));
    return { result, output: "" };
  }

  console.log(bold(`\n${entry.label}: running ${checks.length} k6 script(s)...`));
  const t0 = Date.now();
  let blockerOk = true;
  let advisoryFailed = 0;
  let combinedOutput = "";
  const scripts = [];

  for (const check of checks) {
    const r = spawnSync("k6", ["run", check.file], { stdio: "pipe", cwd, env: buildRuntimeEnv(cwd) });
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

function runTechnicalGroup({ cwd, evid, entry, checks, capture }) {
  if (checks.length === 0) {
    const result = emptyGroupEvidence(entry, "no generated technical runners");
    writeEvidence(evid, entry.evidence_file, result);
    return { result, output: "" };
  }

  console.log(bold(`\n${entry.label}: running ${checks.length} generated technical runner(s)...`));
  const t0 = Date.now();
  let blockerOk = true;
  let advisoryFailed = 0;
  let passed = 0;
  let failed = 0;
  let combinedOutput = "";
  const runners = [];

  for (const check of checks) {
    const res = spawnSync("node", [check.file], { stdio: "pipe", cwd, env: buildRuntimeEnv(cwd) });
    const output = (res.stdout?.toString() || "") + (res.stderr?.toString() || "");
    combinedOutput += output;
    writeArtifact(evid, `${path.basename(check.file)}.log`, output);
    if (!capture && output) process.stdout.write(output);
    const ok = res.status === 0;
    runners.push({
      file: check.file,
      id: check.id,
      severity: check.severity,
      ok,
      exit_code: res.status ?? 1,
    });
    if (ok) {
      passed += 1;
      console.log(green(`  ✓ ${path.basename(check.file)}`));
      continue;
    }

    if (check.severity === "warn") {
      advisoryFailed += 1;
      console.log(yellow(`  ! ${path.basename(check.file)} (warn)`));
    } else {
      blockerOk = false;
      failed += 1;
      console.log(red(`  ✗ ${path.basename(check.file)}`));
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
    passed,
    failed,
    skipped_count: 0,
    advisory_failed: advisoryFailed,
    files: checks.flatMap(check => [check.file, ...(check.companion_files || [])]).filter(Boolean),
    checks,
    runners,
  };
  writeEvidence(evid, entry.evidence_file, result);
  return { result, output: combinedOutput };
}

function runDomainGroup({ cwd, evid, entry, checks, capture }) {
  if (checks.length === 0) {
    const result = emptyGroupEvidence(entry, "no generated business-domain runners");
    writeEvidence(evid, entry.evidence_file, result);
    return { result, output: "" };
  }

  console.log(bold(`\n${entry.label}: running ${checks.length} generated business-domain runner(s)...`));
  const t0 = Date.now();
  let blockerOk = true;
  let advisoryFailed = 0;
  let passed = 0;
  let failed = 0;
  let combinedOutput = "";
  const runners = [];

  for (const check of checks) {
    const res = spawnSync("node", [check.file], { stdio: "pipe", cwd, env: buildRuntimeEnv(cwd) });
    const output = (res.stdout?.toString() || "") + (res.stderr?.toString() || "");
    combinedOutput += output;
    writeArtifact(evid, `${path.basename(check.file)}.log`, output);
    if (!capture && output) process.stdout.write(output);
    const ok = res.status === 0;
    runners.push({
      file: check.file,
      id: check.id,
      severity: check.severity,
      ok,
      exit_code: res.status ?? 1,
    });
    if (ok) {
      passed += 1;
      console.log(green(`  ✓ ${path.basename(check.file)}`));
      continue;
    }

    if (check.severity === "warn") {
      advisoryFailed += 1;
      console.log(yellow(`  ! ${path.basename(check.file)} (warn)`));
    } else {
      blockerOk = false;
      failed += 1;
      console.log(red(`  ✗ ${path.basename(check.file)}`));
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
    passed,
    failed,
    skipped_count: 0,
    advisory_failed: advisoryFailed,
    files: checks.flatMap(check => [check.file, ...(check.companion_files || [])]).filter(Boolean),
    checks,
    runners,
  };
  writeEvidence(evid, entry.evidence_file, result);
  return { result, output: combinedOutput };
}

export async function verify({ cwd, capture = false, verbose = false }) {
  const evid = ensureEvidence(cwd);
  const lock = loadLock(cwd);
  verifyLock(cwd, lock);
  const manifest = loadManifest(cwd);

  const startedAt = Date.now();
  const allOutputs = [];
  const groups = [];
  const managedServer = await ensureManagedWebServer(cwd);
  writeArtifact(evid, "managed-runtime.log", (managedServer.trace || []).join("\n"));

  if (!managedServer.ok) {
    const result = {
      version: 2,
      started_at: new Date(startedAt).toISOString(),
      duration_ms: Date.now() - startedAt,
      exit_code: 1,
      ok: false,
      passed: 0,
      failed: 1,
      advisory_failed: 0,
      skipped: 0,
      groups: [],
    };
    writeEvidence(evid, "run.json", result);
    writeArtifact(evid, "managed-runtime.log", [...(managedServer.trace || []), managedServer.output || ""].filter(Boolean).join("\n"));
    return { exitCode: 1, output: managedServer.output };
  }

  try {
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

    for (const entry of listCucumberTypes()) {
      const checks = collectGeneratedChecksByType(cwd, manifest, entry);
      const group = await runCucumberGroup({ cwd, evid, entry, checks, capture, managedServer });
      groups.push(group.result);
      if (group.output) allOutputs.push(group.output);
    }

    for (const entry of listPlaywrightTypes()) {
      const checks = collectGeneratedChecksByType(cwd, manifest, entry);
      const group = await runPlaywrightGroup({ cwd, evid, entry, checks, capture, managedServer });
      groups.push(group.result);
      if (group.output) allOutputs.push(group.output);
    }

    for (const entry of listK6Types()) {
      const checks = collectGeneratedChecksByType(cwd, manifest, entry);
      const group = runK6Group({ cwd, evid, entry, checks, verbose });
      groups.push(group.result);
      if (group.output) allOutputs.push(group.output);
    }

    for (const entry of listTechnicalTypes()) {
      const checks = collectGeneratedChecksByType(cwd, manifest, entry);
      const group = runTechnicalGroup({ cwd, evid, entry, checks, capture });
      groups.push(group.result);
      if (group.output) allOutputs.push(group.output);
    }

    for (const entry of listDomainTypes()) {
      const checks = collectGeneratedChecksByType(cwd, manifest, entry);
      const group = runDomainGroup({ cwd, evid, entry, checks, capture });
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
    writeArtifact(evid, "managed-runtime.log", (managedServer.trace || []).join("\n"));
    return { exitCode, output: allOutputs.join("\n") };
  } finally {
    await stopManagedServer(managedServer.server);
  }
}
