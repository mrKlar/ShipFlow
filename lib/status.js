import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { computeVerificationPackSnapshot, diffVerificationPackSnapshots } from "./util/vp-snapshot.js";
import { green, red, yellow, bold, dim } from "./util/color.js";
import { loadManifest } from "./gen.js";
import { collectGeneratedArtifactItems, collectVerificationPackItems, hashLockItems } from "./util/verification-lock.js";
import { loadDecisions } from "./decisions.js";
import { loadGrillSessions } from "./grill.js";
import { summarizeApprovalGate } from "./approvals.js";
import { loadSlices, deriveSliceProgress } from "./slices.js";
import { loadReviews } from "./reviews.js";

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
      clarifications: [],
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
    blockingReasons.push(`Draft session still has ${pending} pending proposal(s).`);
  }
  if (acceptedUnwrittenPaths.length > 0) {
    blockingReasons.push(`${acceptedUnwrittenPaths.length} accepted proposal(s) are not yet written to vp/**.`);
  }
  if (snapshotMismatch) {
    blockingReasons.push(`Verification pack changed after the last saved draft session (${stalePaths.length || "unknown"} file(s)).`);
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
    clarifications: Array.isArray(draftSession.clarifications) ? draftSession.clarifications : [],
    proposal_validation: draftSession.proposal_validation ?? null,
  };
}

function readLockStatus(cwd, vpDir, lockPath) {
  if (!fs.existsSync(lockPath) || !fs.existsSync(vpDir)) {
    return { present: false, fresh: null, pack_fresh: null, generated_fresh: null, covers_generated: null, error: null };
  }

  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    const vpSha = hashLockItems(collectVerificationPackItems(cwd, vpDir));
    const coversGenerated = typeof lock.generated_sha256 === "string" && Array.isArray(lock.generated_files);
    const generatedFresh = coversGenerated
      ? hashLockItems(collectGeneratedArtifactItems(cwd, path.dirname(lockPath))) === lock.generated_sha256
      : false;
    const packFresh = vpSha === lock.vp_sha256;
    return {
      present: true,
      fresh: packFresh && generatedFresh,
      pack_fresh: packFresh,
      generated_fresh: generatedFresh,
      covers_generated: coversGenerated,
      error: null,
    };
  } catch {
    return { present: true, fresh: null, pack_fresh: null, generated_fresh: null, covers_generated: null, error: "unreadable" };
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

function summarizeImplementationGate(verifications, draftSession, approvalGate = null) {
  const blockingReasons = [];
  if (verifications.empty) {
    blockingReasons.push("No verification pack is present. Run shipflow draft to define vp/**.");
  }
  if (draftSession && !draftSession.ready_for_implement) {
    blockingReasons.push(...(draftSession.blocking_reasons || []));
  }
  if (approvalGate) {
    blockingReasons.push(...(approvalGate.blocking_reasons || []));
  }
  return {
    ready: blockingReasons.length === 0,
    source: draftSession ? "draft_session" : "verification_pack",
    blocking_reasons: [...new Set(blockingReasons)],
    approval: approvalGate || undefined,
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
    domain: countFiles(path.join(vpDir, "domain"), ".yml"),
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
  verifications.total = verifications.ui + verifications.behavior + verifications.domain + verifications.api + verifications.database
    + verifications.performance + verifications.security + verifications.technical;
  verifications.empty = verifications.total === 0;

  const generated = {
    playwright: manifest
      ? Object.values(manifest.outputs || {})
        .filter(output => output.output_kind === "playwright")
        .reduce((total, output) => total + (output.count || 0), 0)
      : (fs.existsSync(path.join(genDir, "playwright")) ? countFiles(path.join(genDir, "playwright"), ".ts") : 0),
    cucumber: manifest
      ? Object.values(manifest.outputs || {})
        .filter(output => output.output_kind === "cucumber")
        .reduce((total, output) => total + (output.count || 0), 0)
      : (fs.existsSync(path.join(genDir, "cucumber", "features")) ? countFiles(path.join(genDir, "cucumber", "features"), ".feature") : 0),
    k6: manifest?.outputs?.nfr?.count ?? (fs.existsSync(path.join(genDir, "k6")) ? countFiles(path.join(genDir, "k6"), ".js") : 0),
    technical: manifest
      ? Object.values(manifest.outputs || {})
        .filter(output => output.output_kind === "technical")
        .reduce((total, output) => total + (output.count || 0), 0)
      : (fs.existsSync(path.join(genDir, "technical")) ? countFiles(path.join(genDir, "technical"), ".mjs") : 0),
  };
  generated.empty = generated.playwright === 0 && generated.cucumber === 0 && generated.k6 === 0 && generated.technical === 0;

  const lock = readLockStatus(cwd, vpDir, lockPath);
  const run = summarizeRun(readJsonIfExists(path.join(evidDir, "run.json")));
  const implement = summarizeImplement(readJsonIfExists(path.join(evidDir, "implement.json")));
  const implementHistory = summarizeImplementHistory(readJsonIfExists(path.join(evidDir, "implement-history.json")));
  const approvalGate = summarizeApprovalGate(cwd);
  const implementationGate = summarizeImplementationGate(verifications, draftSession, approvalGate);
  const decisions = summarizeDecisions(cwd);
  const grill = summarizeGrill(cwd);
  const slices = summarizeSlices(cwd);
  const reviews = summarizeReviews(cwd);

  return {
    cwd,
    verifications,
    draft_session: draftSession,
    implementation_gate: implementationGate,
    generated,
    lock,
    decisions,
    grill,
    slices,
    reviews,
    approval: approvalGate,
    evidence: {
      run,
      implement,
      implement_history: implementHistory,
    },
  };
}

function summarizeReviews(cwd) {
  const { items, issues } = loadReviews(cwd);
  const byStatus = { open: 0, resolved: 0, wont_fix: 0, obsolete: 0 };
  for (const r of items) {
    if (byStatus[r.status] !== undefined) byStatus[r.status] += 1;
  }
  return {
    total: items.length,
    by_status: byStatus,
    issues: issues.length,
  };
}

function summarizeSlices(cwd) {
  const { items, issues } = loadSlices(cwd);
  const byStatus = {};
  let totalVp = 0;
  let presentVp = 0;
  for (const s of items) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    const p = deriveSliceProgress(cwd, s);
    totalVp += p.vp_total;
    presentVp += p.vp_present;
  }
  return {
    total: items.length,
    by_status: byStatus,
    vp_present: presentVp,
    vp_total: totalVp,
    issues: issues.length,
  };
}

function summarizeGrill(cwd) {
  const { items, issues } = loadGrillSessions(cwd);
  let openQuestions = 0;
  let proposedDecisions = 0;
  for (const s of items) {
    openQuestions += (s.questions || []).filter(q => !q.answer).length;
    proposedDecisions += (s.proposed_decisions || []).length;
  }
  return {
    sessions: items.length,
    open_questions: openQuestions,
    proposed_decisions: proposedDecisions,
    latest: items.length > 0 ? items[items.length - 1].id : null,
    issues: issues.length,
  };
}

function summarizeDecisions(cwd) {
  const { items, issues } = loadDecisions(cwd);
  const byStatus = { proposed: 0, accepted: 0, superseded: 0, rejected: 0 };
  let linkedToVp = 0;
  for (const d of items) {
    if (byStatus[d.status] !== undefined) byStatus[d.status] += 1;
    if (d.impacts && d.impacts.length > 0) linkedToVp += 1;
  }
  return {
    total: items.length,
    by_status: byStatus,
    linked_to_vp: linkedToVp,
    unlinked: items.length - linkedToVp,
    issues: issues.length,
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
    if (data.verifications.domain) lines.push(`    Business Domain: ${data.verifications.domain} check(s)`);
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
    if ((data.draft_session.clarifications || []).length > 0) lines.push(`    Clarify:   ${(data.draft_session.clarifications || []).length}`);
    if (data.draft_session.accepted_unwritten) lines.push(`    Unwritten: ${data.draft_session.accepted_unwritten}`);
    if (data.draft_session.stale) lines.push(`    Stale:     ${yellow("YES")}`);
    lines.push(`    Ready:     ${data.draft_session.ready_for_implement ? green("YES") : yellow("NO")}`);
    if (data.draft_session.updated_at) lines.push(`    Updated:   ${data.draft_session.updated_at}`);
    for (const reason of data.draft_session.blocking_reasons || []) {
      lines.push(`    Blocked:   ${reason}`);
    }
    lines.push("");
  }

  lines.push(bold("  Implement gate:"));
  lines.push(`    Ready:     ${data.implementation_gate.ready ? green("YES") : yellow("NO")}`);
  lines.push(`    Source:    ${data.implementation_gate.source}`);
  for (const reason of data.implementation_gate.blocking_reasons || []) {
    lines.push(`    Blocked:   ${reason}`);
  }
  lines.push("");

  if (data.approval) {
    const a = data.approval;
    const tag = a.required
      ? (a.approved ? green("APPROVED ✓") : red("REQUIRED — NOT APPROVED"))
      : (a.approved ? green("approved (advisory)") : dim("not approved (gating disabled)"));
    lines.push(bold("  Pack approval:"));
    lines.push(`    Status:    ${tag}`);
    lines.push(dim(`    Pack sha:  ${a.pack_sha256.slice(0, 16)}…`));
    if (a.latest) {
      const matches = a.latest.pack_sha256 === a.pack_sha256 ? green("matches current pack") : yellow("for an older pack");
      lines.push(dim(`    Latest:    ${a.latest.id} — ${a.latest.approved_by} (${a.latest.role}) ${matches}`));
    } else {
      lines.push(dim("    Latest:    none"));
    }
    lines.push("");
  }

  if (data.reviews && data.reviews.total > 0) {
    const open = data.reviews.by_status.open || 0;
    if (open > 0 || data.reviews.total > 0) {
      lines.push(bold("  Artifact reviews:"));
      lines.push(`    Total:     ${data.reviews.total}`);
      if (open > 0) lines.push(yellow(`    Open:      ${open} (resolve via shipflow review-artifact resolve <id>)`));
      if (data.reviews.by_status.resolved) lines.push(`    Resolved:  ${data.reviews.by_status.resolved}`);
      if (data.reviews.by_status.wont_fix) lines.push(`    Wont fix:  ${data.reviews.by_status.wont_fix}`);
      lines.push("");
    }
  }

  if (data.slices && data.slices.total > 0) {
    lines.push(bold("  Slices:"));
    lines.push(`    Total:     ${data.slices.total}`);
    for (const [status, count] of Object.entries(data.slices.by_status)) {
      lines.push(`    ${status.padEnd(11, " ")}${count}`);
    }
    lines.push(`    VP cover:  ${data.slices.vp_present}/${data.slices.vp_total}`);
    if (data.slices.issues > 0) lines.push(red(`    ${data.slices.issues} issue(s) — run shipflow slice list`));
    lines.push("");
  }

  if (data.grill && data.grill.sessions > 0) {
    lines.push(bold("  Grill:"));
    lines.push(`    Sessions:  ${data.grill.sessions}`);
    if (data.grill.open_questions > 0) lines.push(yellow(`    Open Qs:   ${data.grill.open_questions} (answer in .shipflow/grill/<id>.md)`));
    if (data.grill.proposed_decisions > 0) lines.push(`    Proposed:  ${data.grill.proposed_decisions} decision(s) ready to promote`);
    if (data.grill.latest) lines.push(dim(`    Latest:    ${data.grill.latest}`));
    if (data.grill.issues > 0) lines.push(red(`    ${data.grill.issues} issue(s) — run shipflow grill list`));
    lines.push("");
  }

  if (data.decisions && data.decisions.total > 0) {
    lines.push(bold("  Decisions:"));
    lines.push(`    Total:     ${data.decisions.total}`);
    if (data.decisions.by_status?.accepted) lines.push(`    Accepted:  ${data.decisions.by_status.accepted}`);
    if (data.decisions.by_status?.proposed) lines.push(`    Proposed:  ${data.decisions.by_status.proposed}`);
    if (data.decisions.by_status?.superseded) lines.push(`    Superseded:${data.decisions.by_status.superseded}`);
    if (data.decisions.by_status?.rejected) lines.push(`    Rejected:  ${data.decisions.by_status.rejected}`);
    lines.push(`    Linked VP: ${data.decisions.linked_to_vp}/${data.decisions.total}`);
    if (data.decisions.unlinked > 0) lines.push(yellow(`    ${data.decisions.unlinked} decision(s) without vp impacts — link with shipflow decision link`));
    if (data.decisions.issues > 0) lines.push(red(`    ${data.decisions.issues} issue(s) — run shipflow decision list`));
    lines.push("");
  }

  if (data.generated.empty) {
    lines.push(yellow("  .gen/  (empty — run shipflow gen)"));
  } else {
    lines.push(bold("  Generated:"));
    if (data.generated.playwright) lines.push(`    Playwright: ${data.generated.playwright} test(s)`);
    if (data.generated.cucumber) lines.push(`    Cucumber:   ${data.generated.cucumber} feature(s)`);
    if (data.generated.k6) lines.push(`    k6:         ${data.generated.k6} script(s)`);
    if (data.generated.technical) lines.push(`    Technical:  ${data.generated.technical} runner(s)`);
  }
  if (data.lock.present) {
    if (data.lock.fresh === true) lines.push(green("    Lock: fresh ✓"));
    else if (data.lock.fresh === false && data.lock.covers_generated === false) lines.push(red("    Lock: incomplete — run shipflow gen"));
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
