import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { listFilesRec } from "./util/fs.js";
import { sha256 } from "./util/hash.js";
import { computeVerificationPackSnapshot, diffVerificationPackSnapshots } from "./util/vp-snapshot.js";
import { green, red, yellow, bold, dim } from "./util/color.js";
import { loadManifest } from "./gen.js";

function countFiles(dir, ext) {
  if (!fs.existsSync(dir)) return 0;
  const yamlAlt = ext === ".yml" ? ".yaml" : null;
  return fs.readdirSync(dir).filter(f => f.endsWith(ext) || (yamlAlt && f.endsWith(yamlAlt))).length;
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function readDraftSessionState(cwd) {
  const file = path.join(cwd, ".shipflow", "draft-session.json");
  if (!fs.existsSync(file)) {
    return { present: false, readable: true, path: file, data: null, error: null };
  }
  try {
    return {
      present: true,
      readable: true,
      path: file,
      data: JSON.parse(fs.readFileSync(file, "utf-8")),
      error: null,
    };
  } catch (error) {
    return {
      present: true,
      readable: false,
      path: file,
      data: null,
      error: error instanceof Error ? error.message : "unreadable",
    };
  }
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, sortValue(value[key])]),
    );
  }
  return value;
}

function valuesEqual(left, right) {
  return JSON.stringify(sortValue(left)) === JSON.stringify(sortValue(right));
}

function loadYamlIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return yaml.load(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function proposalMatchesFile(cwd, proposal) {
  if (!proposal?.path || proposal?.data === undefined) return false;
  const file = path.join(cwd, proposal.path);
  const actual = loadYamlIfExists(file);
  if (actual === null) return false;
  return valuesEqual(actual, proposal.data);
}

function summarizeDraftSession(cwd, draftSessionState) {
  if (!draftSessionState.present) return null;

  if (!draftSessionState.readable) {
    return {
      present: true,
      readable: false,
      path: path.relative(cwd, draftSessionState.path).replaceAll("\\", "/"),
      request: "",
      review: {
        accepted: 0,
        rejected: 0,
        pending: 0,
        suggested_write: 0,
      },
      accepted_unwritten: 0,
      accepted_unwritten_paths: [],
      ready_for_implement: false,
      blocking_reasons: ["Draft session is unreadable. Run shipflow draft --clear-session to reset it."],
      updated_at: null,
      proposal_validation: null,
    };
  }

  const draftSession = draftSessionState.data || {};
  const proposals = Array.isArray(draftSession.proposals) ? draftSession.proposals : [];
  const accepted = proposals.filter(proposal => proposal?.review?.decision === "accept");
  const currentSnapshot = computeVerificationPackSnapshot(cwd);
  const stalePaths = draftSession.vp_snapshot
    ? diffVerificationPackSnapshots(draftSession.vp_snapshot, currentSnapshot)
    : [];
  const snapshotMismatch = draftSession.vp_snapshot
    ? draftSession.vp_snapshot.vp_sha256 !== currentSnapshot.vp_sha256
    : false;
  const acceptedUnwrittenPaths = accepted
    .filter(proposal => !proposalMatchesFile(cwd, proposal))
    .map(proposal => proposal.path)
    .filter(Boolean);
  const pending = draftSession.review?.pending ?? proposals
    .filter(proposal => proposal?.review?.decision !== "accept" && proposal?.review?.decision !== "reject")
    .length;
  const blockingReasons = [];

  if (pending > 0) {
    blockingReasons.push(`Draft review still has ${pending} pending proposal(s).`);
  }
  if (acceptedUnwrittenPaths.length > 0) {
    blockingReasons.push(`${acceptedUnwrittenPaths.length} accepted proposal(s) are not yet written to vp/**.`);
  }
  if (snapshotMismatch) {
    blockingReasons.push(`Verification pack changed after the last draft review (${stalePaths.length || "unknown"} file(s)).`);
  }

  return {
    present: true,
    readable: true,
    path: path.relative(cwd, draftSessionState.path).replaceAll("\\", "/"),
    request: draftSession.request || "",
    review: {
      accepted: draftSession.review?.accepted ?? accepted.length,
      rejected: draftSession.review?.rejected ?? proposals.filter(proposal => proposal?.review?.decision === "reject").length,
      pending,
      suggested_write: draftSession.review?.suggested_write ?? proposals.filter(proposal => proposal?.review?.suggested_write).length,
    },
    accepted_unwritten: acceptedUnwrittenPaths.length,
    accepted_unwritten_paths: acceptedUnwrittenPaths,
    stale: snapshotMismatch,
    stale_paths: stalePaths,
    ready_for_implement: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
    updated_at: draftSession.updated_at ?? null,
    proposal_validation: draftSession.proposal_validation ?? null,
  };
}

function readLockStatus(cwd, vpDir, lockPath) {
  if (!fs.existsSync(lockPath) || !fs.existsSync(vpDir)) {
    return { present: false, fresh: null, error: null };
  }

  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    const files = listFilesRec(vpDir).filter(p => !p.includes(`${path.sep}.DS_Store`));
    const items = files.map(p => {
      const rel = path.relative(cwd, p).replaceAll("\\", "/");
      const buf = fs.readFileSync(p);
      return { path: rel, sha256: sha256(buf) };
    }).sort((a, b) => a.path.localeCompare(b.path));
    const vpSha = sha256(Buffer.from(JSON.stringify(items)));
    return {
      present: true,
      fresh: vpSha === lock.vp_sha256,
      error: null,
    };
  } catch {
    return { present: true, fresh: null, error: "unreadable" };
  }
}

function summarizeRun(run) {
  if (!run) return null;
  return {
    ok: Boolean(run.ok),
    duration_ms: run.duration_ms ?? null,
    started_at: run.started_at ?? null,
    passed: run.passed ?? null,
    failed: run.failed ?? null,
    groups: Array.isArray(run.groups)
      ? run.groups.map(group => ({
          type: group.type ?? null,
          label: group.label ?? null,
          ok: group.ok ?? null,
          skipped: Boolean(group.skipped),
        }))
      : [],
  };
}

function summarizeImplement(implement) {
  if (!implement) return null;
  return {
    ok: Boolean(implement.ok),
    stage: implement.stage ?? null,
    iterations: implement.iterations ?? null,
    first_pass_success: Boolean(implement.first_pass_success),
  };
}

function summarizeImplementHistory(history) {
  if (!history) return null;
  const summary = history.summary || {};
  return {
    total_runs: summary.total_runs ?? 0,
    pass_rate: summary.pass_rate ?? 0,
    first_pass_rate: summary.first_pass_rate ?? 0,
    average_iterations: summary.average_iterations ?? 0,
    last_success_at: summary.last_success_at ?? null,
    last_failure_at: summary.last_failure_at ?? null,
  };
}

export function collectStatus(cwd) {
  const vpDir = path.join(cwd, "vp");
  const genDir = path.join(cwd, ".gen");
  const evidDir = path.join(cwd, "evidence");
  const lockPath = path.join(genDir, "vp.lock.json");
  const manifest = loadManifest(cwd);
  const draftSession = summarizeDraftSession(cwd, readDraftSessionState(cwd));

  const verifications = {
    ui: countFiles(path.join(vpDir, "ui"), ".yml"),
    behavior: countFiles(path.join(vpDir, "behavior"), ".yml"),
    api: countFiles(path.join(vpDir, "api"), ".yml"),
    database: countFiles(path.join(vpDir, "db"), ".yml"),
    performance: countFiles(path.join(vpDir, "nfr"), ".yml"),
    security: countFiles(path.join(vpDir, "security"), ".yml"),
    technical: countFiles(path.join(vpDir, "technical"), ".yml"),
    fixtures: countFiles(path.join(vpDir, "ui", "_fixtures"), ".yml"),
    policies: fs.existsSync(path.join(vpDir, "policy"))
      ? fs.readdirSync(path.join(vpDir, "policy")).filter(f => f.endsWith(".rego")).length
      : 0,
  };
  verifications.total = verifications.ui + verifications.behavior + verifications.api + verifications.database
    + verifications.performance + verifications.security + verifications.technical;
  verifications.empty = verifications.total === 0;

  const generated = {
    playwright: manifest
      ? Object.values(manifest.outputs || {})
        .filter(output => output.output_kind === "playwright")
        .reduce((total, output) => total + (output.count || 0), 0)
      : (fs.existsSync(path.join(genDir, "playwright")) ? countFiles(path.join(genDir, "playwright"), ".ts") : 0),
    k6: manifest?.outputs?.nfr?.count ?? (fs.existsSync(path.join(genDir, "k6")) ? countFiles(path.join(genDir, "k6"), ".js") : 0),
  };
  generated.empty = generated.playwright === 0 && generated.k6 === 0;

  const lock = readLockStatus(cwd, vpDir, lockPath);
  const run = summarizeRun(readJsonIfExists(path.join(evidDir, "run.json")));
  const implement = summarizeImplement(readJsonIfExists(path.join(evidDir, "implement.json")));
  const implementHistory = summarizeImplementHistory(readJsonIfExists(path.join(evidDir, "implement-history.json")));

  return {
    cwd,
    verifications,
    draft_session: draftSession,
    generated,
    lock,
    evidence: {
      run,
      implement,
      implement_history: implementHistory,
    },
  };
}

function renderHuman(data) {
  const lines = [];
  lines.push(bold("ShipFlow Status"));
  lines.push("");

  if (data.verifications.empty) {
    lines.push(yellow("  vp/  (empty — run shipflow draft to start)"));
  } else {
    lines.push(bold("  Verifications:"));
    if (data.verifications.ui) lines.push(`    UI:       ${data.verifications.ui} check(s)`);
    if (data.verifications.behavior) lines.push(`    Behavior: ${data.verifications.behavior} check(s)`);
    if (data.verifications.api) lines.push(`    API:         ${data.verifications.api} check(s)`);
    if (data.verifications.database) lines.push(`    Database:    ${data.verifications.database} check(s)`);
    if (data.verifications.performance) lines.push(`    Performance: ${data.verifications.performance} check(s)`);
    if (data.verifications.security) lines.push(`    Security:    ${data.verifications.security} check(s)`);
    if (data.verifications.technical) lines.push(`    Technical:   ${data.verifications.technical} check(s)`);
    if (data.verifications.fixtures) lines.push(`    Fixtures: ${data.verifications.fixtures}`);
    if (data.verifications.policies) lines.push(`    Policies: ${data.verifications.policies}`);
    lines.push(dim(`    Total:    ${data.verifications.total} verification(s)`));
  }
  lines.push("");

  if (data.draft_session) {
    lines.push(bold("  Draft session:"));
    if (data.draft_session.request) lines.push(`    Request:   ${data.draft_session.request}`);
    lines.push(`    Accepted:  ${data.draft_session.review.accepted}`);
    lines.push(`    Rejected:  ${data.draft_session.review.rejected}`);
    lines.push(`    Pending:   ${data.draft_session.review.pending}`);
    lines.push(`    Suggested: ${data.draft_session.review.suggested_write}`);
    if (data.draft_session.accepted_unwritten) lines.push(`    Unwritten: ${data.draft_session.accepted_unwritten}`);
    if (data.draft_session.stale) lines.push(`    Stale:     ${yellow("YES")}`);
    lines.push(`    Ready:     ${data.draft_session.ready_for_implement ? green("YES") : yellow("NO")}`);
    if (data.draft_session.updated_at) lines.push(`    Updated:   ${data.draft_session.updated_at}`);
    for (const reason of data.draft_session.blocking_reasons || []) {
      lines.push(`    Blocked:   ${reason}`);
    }
    lines.push("");
  }

  if (data.generated.empty) {
    lines.push(yellow("  .gen/  (empty — run shipflow gen)"));
  } else {
    lines.push(bold("  Generated:"));
    if (data.generated.playwright) lines.push(`    Playwright: ${data.generated.playwright} test(s)`);
    if (data.generated.k6) lines.push(`    k6:         ${data.generated.k6} script(s)`);
  }
  if (data.lock.present) {
    if (data.lock.fresh === true) lines.push(green("    Lock: fresh ✓"));
    else if (data.lock.fresh === false) lines.push(red("    Lock: STALE — run shipflow gen"));
    else lines.push(yellow("    Lock: unreadable"));
  }
  lines.push("");

  if (!data.evidence.run) {
    lines.push(yellow("  evidence/  (no runs yet — run shipflow verify)"));
  } else {
    lines.push(bold("  Last run:"));
    lines.push(`    Status:   ${data.evidence.run.ok ? green("PASS ✓") : red("FAIL ✗")}`);
    lines.push(`    Duration: ${data.evidence.run.duration_ms}ms`);
    lines.push(`    Date:     ${data.evidence.run.started_at}`);
    if (data.evidence.run.passed !== null) lines.push(`    Passed:   ${data.evidence.run.passed}`);
    if (data.evidence.run.failed !== null) lines.push(`    Failed:   ${data.evidence.run.failed}`);
    for (const group of data.evidence.run.groups) {
      const detail = group.skipped ? "skipped" : group.ok ? "pass" : "fail";
      lines.push(`    ${group.label}: ${detail}`);
    }
  }

  if (data.evidence.implement) {
    lines.push(bold("  Last implement:"));
    lines.push(`    Status:   ${data.evidence.implement.ok ? green("PASS ✓") : red("FAIL ✗")}`);
    lines.push(`    Stage:    ${data.evidence.implement.stage}`);
    lines.push(`    Iter:     ${data.evidence.implement.iterations}`);
    lines.push(`    First:    ${data.evidence.implement.first_pass_success ? green("YES") : yellow("NO")}`);
  }

  if (data.evidence.implement_history) {
    lines.push(bold("  Implement history:"));
    lines.push(`    Runs:     ${data.evidence.implement_history.total_runs}`);
    lines.push(`    Pass:     ${Math.round(data.evidence.implement_history.pass_rate * 100)}%`);
    lines.push(`    First:    ${Math.round(data.evidence.implement_history.first_pass_rate * 100)}%`);
    lines.push(`    Avg iter: ${data.evidence.implement_history.average_iterations}`);
    if (data.evidence.implement_history.last_success_at) lines.push(`    Last ok:  ${data.evidence.implement_history.last_success_at}`);
    if (data.evidence.implement_history.last_failure_at) lines.push(`    Last ko:  ${data.evidence.implement_history.last_failure_at}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function status({ cwd, json = false }) {
  const result = collectStatus(cwd);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderHuman(result));
  }
  return { exitCode: 0, result };
}
