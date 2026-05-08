// shipflow report — aggregate snapshot for weekly / monthly reviews.
// Pulls from every substrate loader and the evidence directory; emits
// human, markdown, or json. Designed to be pasted into a Slack note or
// committed to a CHANGELOG-style file.

import fs from "node:fs";
import path from "node:path";
import { bold, dim, green, yellow, red } from "./util/color.js";
import { loadDecisions } from "./decisions.js";
import { loadGrillSessions } from "./grill.js";
import { loadSlices, deriveSliceProgress } from "./slices.js";
import { loadApprovals, currentPackHash } from "./approvals.js";
import { loadReviews } from "./reviews.js";

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return null; }
}

function countVerifications(cwd) {
  const dir = path.join(cwd, "vp");
  if (!fs.existsSync(dir)) return { total: 0, by_area: {}, policies: 0 };
  const byArea = {};
  let total = 0;
  for (const area of ["ui", "behavior", "domain", "api", "db", "nfr", "security", "technical"]) {
    const areaDir = path.join(dir, area);
    if (!fs.existsSync(areaDir)) { byArea[area] = 0; continue; }
    const count = fs.readdirSync(areaDir)
      .filter(f => (f.endsWith(".yml") || f.endsWith(".yaml")) && !f.startsWith("_"))
      .length;
    byArea[area] = count;
    total += count;
  }
  const policyDir = path.join(dir, "policy");
  const policies = fs.existsSync(policyDir)
    ? fs.readdirSync(policyDir).filter(f => f.endsWith(".rego")).length
    : 0;
  return { total, by_area: byArea, policies };
}

function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buildReport(cwd, { now = new Date() } = {}) {
  const verifications = countVerifications(cwd);

  const decisions = loadDecisions(cwd).items;
  const decisionsByStatus = {};
  let decisionsLinked = 0;
  for (const d of decisions) {
    decisionsByStatus[d.status] = (decisionsByStatus[d.status] || 0) + 1;
    if (d.impacts && d.impacts.length > 0) decisionsLinked += 1;
  }

  const grillSessions = loadGrillSessions(cwd).items;
  const grillByRole = {};
  for (const s of grillSessions) {
    grillByRole[s.role] = (grillByRole[s.role] || 0) + 1;
  }

  const slices = loadSlices(cwd).items;
  const slicesByStatus = {};
  let totalVpCovered = 0;
  let totalVpInSlices = 0;
  for (const s of slices) {
    slicesByStatus[s.status] = (slicesByStatus[s.status] || 0) + 1;
    const p = deriveSliceProgress(cwd, s);
    totalVpInSlices += p.vp_total;
    totalVpCovered += p.vp_present;
  }

  const approvals = loadApprovals(cwd).items;
  const activeApprovals = approvals.filter(a => !a.revoked_at);
  const packHash = currentPackHash(cwd);
  const matchingApprovals = activeApprovals.filter(a => a.pack_sha256 === packHash);
  const latestApproval = activeApprovals.length > 0 ? activeApprovals[activeApprovals.length - 1] : null;
  const latestApprovalDate = latestApproval ? safeDate(latestApproval.approved_at) : null;
  const daysSinceLastApproval = latestApprovalDate ? daysBetween(latestApprovalDate, now) : null;

  const reviews = loadReviews(cwd).items;
  const openReviews = reviews.filter(r => r.status === "open");
  const oldestOpenReview = openReviews
    .map(r => ({ id: r.id, created_at: r.created_at, target: r.target }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] || null;
  const daysOldestOpen = oldestOpenReview
    ? daysBetween(safeDate(oldestOpenReview.created_at) || now, now)
    : null;

  const evidenceDir = path.join(cwd, "evidence");
  const lastRun = readJsonIfExists(path.join(evidenceDir, "run.json"));
  const lastRunDate = safeDate(lastRun?.started_at);
  const daysSinceLastRun = lastRunDate ? daysBetween(lastRunDate, now) : null;

  const lastImplement = readJsonIfExists(path.join(evidenceDir, "implement.json"));
  const lastImplementDate = safeDate(lastImplement?.started_at);

  return {
    generated_at: now.toISOString(),
    pack: {
      sha256: packHash,
      verifications,
    },
    decisions: {
      total: decisions.length,
      by_status: decisionsByStatus,
      linked_to_vp: decisionsLinked,
      orphan: decisions.length - decisionsLinked,
    },
    grill: {
      sessions: grillSessions.length,
      by_role: grillByRole,
    },
    slices: {
      total: slices.length,
      by_status: slicesByStatus,
      vp_present: totalVpCovered,
      vp_total: totalVpInSlices,
    },
    approvals: {
      total: approvals.length,
      active: activeApprovals.length,
      revoked: approvals.length - activeApprovals.length,
      matches_current_pack: matchingApprovals.length,
      latest: latestApproval ? {
        id: latestApproval.id,
        approved_by: latestApproval.approved_by,
        role: latestApproval.role,
        approved_at: latestApproval.approved_at,
        days_ago: daysSinceLastApproval,
        matches_current_pack: latestApproval.pack_sha256 === packHash,
      } : null,
    },
    reviews: {
      total: reviews.length,
      open: openReviews.length,
      oldest_open: oldestOpenReview
        ? { ...oldestOpenReview, days_open: daysOldestOpen }
        : null,
    },
    evidence: {
      last_run: lastRun ? {
        ok: !!lastRun.ok,
        started_at: lastRun.started_at,
        days_ago: daysSinceLastRun,
        passed: lastRun.passed ?? null,
        failed: lastRun.failed ?? null,
      } : null,
      last_implement: lastImplement ? {
        ok: !!lastImplement.ok,
        stage: lastImplement.stage,
        started_at: lastImplement.started_at,
        days_ago: lastImplementDate ? daysBetween(lastImplementDate, now) : null,
      } : null,
    },
  };
}

function pluralizeDays(n) {
  if (n === null || n === undefined) return "n/a";
  if (n === 0) return "today";
  if (n === 1) return "1 day ago";
  return `${n} days ago`;
}

function renderHuman(report) {
  const lines = [];
  lines.push(bold("ShipFlow Report"));
  lines.push(dim(`  ${report.generated_at}`));
  lines.push("");

  lines.push(bold("  Pack:"));
  lines.push(`    sha256:        ${report.pack.sha256.slice(0, 16)}…`);
  lines.push(`    Verifications: ${report.pack.verifications.total} across ${Object.values(report.pack.verifications.by_area).filter(n => n > 0).length} area(s)`);
  for (const [area, count] of Object.entries(report.pack.verifications.by_area)) {
    if (count > 0) lines.push(dim(`      ${area.padEnd(11)} ${count}`));
  }
  if (report.pack.verifications.policies) {
    lines.push(`    Policies:      ${report.pack.verifications.policies}`);
  }
  lines.push("");

  lines.push(bold("  Substrate:"));
  lines.push(`    Decisions:    ${report.decisions.total} (${report.decisions.linked_to_vp} linked, ${report.decisions.orphan} orphan)`);
  lines.push(`    Grill:        ${report.grill.sessions} session(s)`);
  for (const [role, count] of Object.entries(report.grill.by_role)) {
    lines.push(dim(`      ${role.padEnd(13)} ${count}`));
  }
  lines.push(`    Slices:       ${report.slices.total} (vp coverage ${report.slices.vp_present}/${report.slices.vp_total})`);
  for (const [status, count] of Object.entries(report.slices.by_status)) {
    lines.push(dim(`      ${status.padEnd(13)} ${count}`));
  }
  lines.push("");

  lines.push(bold("  Approval:"));
  if (report.approvals.latest) {
    const tag = report.approvals.latest.matches_current_pack ? green("current") : yellow("for an older pack");
    lines.push(`    Latest:        ${report.approvals.latest.approved_by} (${report.approvals.latest.role}) — ${pluralizeDays(report.approvals.latest.days_ago)} (${tag})`);
    lines.push(`    Matching pack: ${report.approvals.matches_current_pack}/${report.approvals.active} active approvals match the current sha`);
  } else {
    lines.push(yellow("    No approvals on file"));
  }
  lines.push("");

  if (report.reviews.total > 0) {
    lines.push(bold("  Reviews:"));
    lines.push(`    Open:        ${report.reviews.open}/${report.reviews.total}`);
    if (report.reviews.oldest_open) {
      const tag = (report.reviews.oldest_open.days_open || 0) >= 14 ? red : yellow;
      lines.push(tag(`    Oldest open: ${report.reviews.oldest_open.id} → ${report.reviews.oldest_open.target} (${pluralizeDays(report.reviews.oldest_open.days_open)})`));
    }
    lines.push("");
  }

  if (report.evidence.last_run) {
    const r = report.evidence.last_run;
    lines.push(bold("  Last verify run:"));
    lines.push(`    ${r.ok ? green("PASS ✓") : red("FAIL ✗")}  ${pluralizeDays(r.days_ago)}  (passed: ${r.passed ?? "?"}, failed: ${r.failed ?? "?"})`);
    lines.push("");
  } else {
    lines.push(yellow("  No verify runs recorded yet."));
    lines.push("");
  }
  return lines.join("\n");
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# ShipFlow report`);
  lines.push("");
  lines.push(`_Generated ${report.generated_at}_`);
  lines.push("");

  lines.push(`## Pack`);
  lines.push("");
  lines.push(`- **sha256**: \`${report.pack.sha256.slice(0, 12)}…\``);
  lines.push(`- **Verifications**: ${report.pack.verifications.total} (${Object.entries(report.pack.verifications.by_area).filter(([, c]) => c > 0).map(([a, c]) => `${a}=${c}`).join(", ") || "none"})`);
  if (report.pack.verifications.policies) lines.push(`- **Policy gates**: ${report.pack.verifications.policies}`);
  lines.push("");

  lines.push(`## Substrate`);
  lines.push("");
  lines.push(`| Surface | Total | Notes |`);
  lines.push(`| --- | --- | --- |`);
  lines.push(`| Decisions | ${report.decisions.total} | ${report.decisions.linked_to_vp} linked, ${report.decisions.orphan} orphan |`);
  lines.push(`| Grill sessions | ${report.grill.sessions} | ${Object.entries(report.grill.by_role).map(([r, n]) => `${r}=${n}`).join(", ") || "none"} |`);
  lines.push(`| Slices | ${report.slices.total} | vp ${report.slices.vp_present}/${report.slices.vp_total}, ${Object.entries(report.slices.by_status).map(([s, n]) => `${s}=${n}`).join(", ") || "none"} |`);
  lines.push("");

  lines.push(`## Approval`);
  lines.push("");
  if (report.approvals.latest) {
    const tag = report.approvals.latest.matches_current_pack ? "✅ current" : "⚠️ older pack";
    lines.push(`- **Latest**: ${report.approvals.latest.approved_by} (${report.approvals.latest.role}) — ${pluralizeDays(report.approvals.latest.days_ago)} (${tag})`);
    lines.push(`- **Matching current pack**: ${report.approvals.matches_current_pack}/${report.approvals.active}`);
  } else {
    lines.push(`- ⚠️ no approvals on file`);
  }
  lines.push("");

  lines.push(`## Reviews`);
  lines.push("");
  lines.push(`- **Open**: ${report.reviews.open}/${report.reviews.total}`);
  if (report.reviews.oldest_open) {
    lines.push(`- **Oldest open**: \`${report.reviews.oldest_open.id}\` → \`${report.reviews.oldest_open.target}\` (${pluralizeDays(report.reviews.oldest_open.days_open)})`);
  }
  lines.push("");

  lines.push(`## Evidence`);
  lines.push("");
  if (report.evidence.last_run) {
    const r = report.evidence.last_run;
    lines.push(`- **Last verify**: ${r.ok ? "✅ PASS" : "❌ FAIL"} — ${pluralizeDays(r.days_ago)} (passed=${r.passed ?? "?"}, failed=${r.failed ?? "?"})`);
  } else {
    lines.push(`- ⚠️ no verify runs recorded yet`);
  }
  if (report.evidence.last_implement) {
    const i = report.evidence.last_implement;
    lines.push(`- **Last implement**: ${i.ok ? "✅" : "❌"} stage=\`${i.stage}\` — ${pluralizeDays(i.days_ago)}`);
  }
  return lines.join("\n");
}

export function reportCli({ cwd, args = [], json = false } = {}) {
  const flags = new Set(args.filter(a => a.startsWith("--")));
  const wantsMarkdown = flags.has("--markdown") || flags.has("--md");
  const report = buildReport(cwd);
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return { exitCode: 0 };
  }
  if (wantsMarkdown) {
    process.stdout.write(renderMarkdown(report) + "\n");
    return { exitCode: 0 };
  }
  console.log(renderHuman(report));
  return { exitCode: 0 };
}
