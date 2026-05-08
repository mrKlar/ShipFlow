import fs from "node:fs";
import path from "node:path";
import { bold, dim, green, yellow, red } from "./util/color.js";
import { loadDecisions } from "./decisions.js";
import { loadGrillSessions } from "./grill.js";
import { loadSlices } from "./slices.js";
import { loadApprovals, currentPackHash } from "./approvals.js";
import { loadReviews } from "./reviews.js";
import { loadManifest } from "./gen.js";

function listVpFiles(cwd) {
  const vpDir = path.join(cwd, "vp");
  if (!fs.existsSync(vpDir)) return [];
  const out = [];
  for (const area of ["ui", "behavior", "api", "db", "domain", "nfr", "security", "technical"]) {
    const dir = path.join(vpDir, area);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".yml") || file.endsWith(".yaml")) {
        out.push(`vp/${area}/${file}`);
      }
    }
  }
  const policyDir = path.join(vpDir, "policy");
  if (fs.existsSync(policyDir)) {
    for (const file of fs.readdirSync(policyDir)) {
      if (file.endsWith(".rego")) out.push(`vp/policy/${file}`);
    }
  }
  return out.sort();
}

function listEvidenceFiles(cwd) {
  const dir = path.join(cwd, "evidence");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  function walk(p) {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(json|log|txt)$/i.test(ent.name)) {
        out.push(path.relative(cwd, full).replaceAll("\\", "/"));
      }
    }
  }
  walk(dir);
  return out.sort();
}

function manifestOutputsByVpFile(cwd) {
  const manifest = loadManifest(cwd);
  const map = new Map();
  if (!manifest || !manifest.outputs) return map;
  for (const [, group] of Object.entries(manifest.outputs)) {
    if (!group || !Array.isArray(group.entries)) continue;
    for (const entry of group.entries) {
      const vpFile = entry.vp_file || entry.source || entry.input;
      if (!vpFile) continue;
      const list = map.get(vpFile) || [];
      list.push({
        kind: group.output_kind || "unknown",
        path: entry.output || entry.path || entry.target,
      });
      map.set(vpFile, list);
    }
  }
  return map;
}

// Evidence files in ShipFlow are typically per-group (run.json, policy.json,
// implement.json, visual/<id>/, agents/*.jsonl) rather than per-vp-file.
// Match conservatively: only treat an evidence path as belonging to a vp file
// when the basename matches exactly OR the path contains the vp basename as
// a full directory segment. Substring matching produces false positives
// (vp/api/auth.yml previously matched evidence/reauth.json).
function matchEvidenceForVp(vpFile, evidenceFiles) {
  const base = path.basename(vpFile, path.extname(vpFile));
  if (!base) return [];
  const dirToken = `/${base}/`;
  const dotSuffix = `/${base}.`;
  return evidenceFiles.filter(e => {
    const evBase = path.basename(e, path.extname(e));
    if (evBase === base) return true;
    if (e.includes(dirToken)) return true;
    if (e.includes(dotSuffix)) return true;
    return false;
  });
}

function indexBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const keys = keyFn(item);
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
  }
  return map;
}

export function buildTrace(cwd, deps = {}) {
  const vpFiles = deps.vpFiles ?? listVpFiles(cwd);
  const decisions = deps.decisions ?? loadDecisions(cwd).items;
  const grillSessions = deps.grillSessions ?? loadGrillSessions(cwd).items;
  // Pass id sets to loadSlices so it does not re-read decisions/grill from disk.
  const slices = deps.slices ?? loadSlices(cwd, {
    decisionIds: new Set(decisions.map(d => d.id)),
    grillIds: new Set(grillSessions.map(s => s.id)),
  }).items;
  const approvals = deps.approvals ?? loadApprovals(cwd).items;
  const reviews = deps.reviews ?? loadReviews(cwd).items;
  const evidenceFiles = deps.evidenceFiles ?? listEvidenceFiles(cwd);
  const generatedByVp = deps.generatedByVp ?? manifestOutputsByVpFile(cwd);
  const packHash = deps.packHash ?? currentPackHash(cwd);
  const activeApprovals = approvals.filter(a => !a.revoked_at && a.pack_sha256 === packHash);

  const decisionsByImpact = indexBy(decisions, d => (d.impacts || []).map(p => p.replaceAll("\\", "/")));
  const slicesByVp = indexBy(slices, s => (s.vp || []).map(p => p.replaceAll("\\", "/")));
  const reviewsByTarget = indexBy(reviews, r => r.target.replaceAll("\\", "/"));

  const grillById = new Map(grillSessions.map(s => [s.id, s]));
  const decisionById = new Map(decisions.map(d => [d.id, d]));

  const rows = [];
  for (const vp of vpFiles) {
    const linkedDecisions = decisionsByImpact.get(vp) || [];
    const linkedSlices = slicesByVp.get(vp) || [];
    const grillRefs = new Set();
    for (const d of linkedDecisions) {
      if (d.source === "grill" && d.source_ref) grillRefs.add(d.source_ref);
    }
    for (const s of linkedSlices) {
      for (const g of s.grill_refs || []) grillRefs.add(g);
    }
    const grillForRow = [...grillRefs].map(id => grillById.get(id)).filter(Boolean);
    const generated = generatedByVp.get(vp) || [];
    const evidence = matchEvidenceForVp(vp, evidenceFiles);
    const reviewsForRow = reviewsByTarget.get(vp) || [];

    rows.push({
      vp,
      slices: linkedSlices.map(s => ({ id: s.id, status: s.status, goal: s.goal })),
      decisions: linkedDecisions.map(d => ({ id: d.id, type: d.type, status: d.status, source: d.source, source_ref: d.source_ref })),
      grill_sessions: grillForRow.map(s => ({ id: s.id, role: s.role, intent: s.intent })),
      generated,
      evidence,
      reviews: reviewsForRow.map(r => ({ id: r.id, status: r.status, kind: r.kind, text: r.text })),
      decision_count: linkedDecisions.length,
      grill_count: grillForRow.length,
      slice_count: linkedSlices.length,
      generated_count: generated.length,
      evidence_count: evidence.length,
      open_review_count: reviewsForRow.filter(r => r.status === "open").length,
    });
  }

  // Orphans: decisions / grill / slices / reviews not bound to any vp file
  const boundVpSet = new Set(vpFiles);
  const orphanDecisions = decisions.filter(d =>
    !(d.impacts || []).some(p => boundVpSet.has(p.replaceAll("\\", "/")))
  );
  const orphanSlices = slices.filter(s =>
    !(s.vp || []).some(p => boundVpSet.has(p.replaceAll("\\", "/")))
  );
  const orphanReviews = reviews.filter(r =>
    r.target_kind === "vp" && !boundVpSet.has(r.target.replaceAll("\\", "/"))
  );

  return {
    pack_sha256: packHash,
    approval: activeApprovals.length > 0
      ? activeApprovals.map(a => ({ id: a.id, approved_by: a.approved_by, role: a.role, approved_at: a.approved_at }))
      : [],
    rows,
    summary: {
      vp_files: vpFiles.length,
      decisions: decisions.length,
      slices: slices.length,
      grill_sessions: grillSessions.length,
      reviews: reviews.length,
      generated_files: [...generatedByVp.values()].reduce((acc, list) => acc + list.length, 0),
      evidence_files: evidenceFiles.length,
    },
    orphans: {
      decisions: orphanDecisions.map(d => ({ id: d.id, title: d.title })),
      slices: orphanSlices.map(s => ({ id: s.id, goal: s.goal })),
      reviews: orphanReviews.map(r => ({ id: r.id, target: r.target })),
    },
  };
}

function renderHumanTrace(trace) {
  const lines = [];
  lines.push(bold("ShipFlow Traceability"));
  lines.push(dim(`  pack sha256: ${trace.pack_sha256}`));
  if (trace.approval.length > 0) {
    lines.push(green(`  approved by: ${trace.approval.map(a => `${a.approved_by} (${a.role})`).join(", ")}`));
  } else {
    lines.push(yellow("  not approved against current pack hash"));
  }
  lines.push("");

  if (trace.rows.length === 0) {
    lines.push(dim("  No vp files yet."));
  } else {
    for (const row of trace.rows) {
      lines.push(bold(`  ${row.vp}`));
      if (row.slices.length) {
        lines.push(`    slice:     ${row.slices.map(s => `${s.id} (${s.status})`).join(", ")}`);
      }
      if (row.decisions.length) {
        lines.push(`    decisions: ${row.decisions.map(d => d.id).join(", ")}`);
      } else {
        lines.push(yellow("    decisions: (none — link with shipflow decision link)"));
      }
      if (row.grill_sessions.length) {
        lines.push(`    grill:     ${row.grill_sessions.map(g => g.id).join(", ")}`);
      }
      if (row.generated.length) {
        lines.push(`    generated: ${row.generated.map(g => `${g.kind}:${g.path}`).join(", ")}`);
      }
      if (row.evidence.length) {
        lines.push(`    evidence:  ${row.evidence.join(", ")}`);
      } else {
        lines.push(dim("    evidence:  (no run yet)"));
      }
      if (row.open_review_count > 0) {
        lines.push(yellow(`    reviews:   ${row.open_review_count} open`));
      }
    }
  }

  lines.push("");
  lines.push(bold("  Orphans:"));
  lines.push(`    decisions without vp impact: ${trace.orphans.decisions.length}`);
  lines.push(`    slices with no existing vp:  ${trace.orphans.slices.length}`);
  lines.push(`    reviews on missing vp paths: ${trace.orphans.reviews.length}`);
  for (const d of trace.orphans.decisions) lines.push(dim(`      decision ${d.id} — ${d.title}`));
  for (const s of trace.orphans.slices) lines.push(dim(`      slice ${s.id}`));
  for (const r of trace.orphans.reviews) lines.push(dim(`      review ${r.id} -> ${r.target}`));
  return lines.join("\n");
}

function renderMarkdownTrace(trace) {
  const lines = [];
  lines.push(`# ShipFlow Traceability`);
  lines.push("");
  lines.push(`- **pack sha256:** \`${trace.pack_sha256}\``);
  lines.push(`- **approvals:** ${trace.approval.length > 0 ? trace.approval.map(a => `${a.approved_by} (${a.role}, ${a.approved_at})`).join(", ") : "_not approved against current pack hash_"}`);
  lines.push("");
  lines.push(`## Matrix`);
  lines.push("");
  lines.push("| VP file | Slice | Decisions | Grill | Generated | Evidence | Open reviews |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of trace.rows) {
    lines.push(`| \`${row.vp}\` | ${row.slices.map(s => s.id).join(", ") || "_none_"} | ${row.decisions.map(d => d.id).join(", ") || "_none_"} | ${row.grill_sessions.map(g => g.id).join(", ") || "_none_"} | ${row.generated.map(g => `${g.kind}:${g.path}`).join(", ") || "_none_"} | ${row.evidence.join(", ") || "_none_"} | ${row.open_review_count} |`);
  }
  lines.push("");
  lines.push(`## Orphans`);
  lines.push("");
  lines.push(`- decisions without vp impact: ${trace.orphans.decisions.length}`);
  lines.push(`- slices with no existing vp: ${trace.orphans.slices.length}`);
  lines.push(`- reviews on missing vp paths: ${trace.orphans.reviews.length}`);
  return lines.join("\n");
}

// Compact PR-comment formatter. Produces a single GitHub-friendly markdown
// block that highlights what a reviewer needs to look at before approving
// the PR: pack approval state, vp coverage, decision linkage, open
// artifact reviews, and any orphans. Designed to be posted as-is by CI
// (via `gh pr comment` or similar).
export function renderPrCommentTrace(trace) {
  const lines = [];
  const approved = trace.approval.length > 0;
  const approvalIcon = approved ? "✅" : "⚠️";
  const approvalText = approved
    ? trace.approval.map(a => `**${a.approved_by}** (${a.role}, ${a.approved_at})`).join(", ")
    : "_pack is not approved against the current sha_";

  lines.push(`### ${approvalIcon} ShipFlow trace`);
  lines.push("");
  lines.push(`**Pack:** \`${trace.pack_sha256.slice(0, 12)}…\``);
  lines.push(`**Approval:** ${approvalText}`);
  lines.push("");

  // Coverage one-liner
  const totalRows = trace.rows.length;
  const linkedRows = trace.rows.filter(r => r.decision_count > 0).length;
  const slicedRows = trace.rows.filter(r => r.slice_count > 0).length;
  const openReviews = trace.rows.reduce((acc, r) => acc + r.open_review_count, 0);
  lines.push(`**VP files:** ${totalRows} — ${linkedRows} linked to a decision, ${slicedRows} grouped in a slice`);
  lines.push(`**Open artifact reviews:** ${openReviews}`);
  if (trace.orphans.decisions.length || trace.orphans.slices.length || trace.orphans.reviews.length) {
    lines.push(`**Orphans:** ${trace.orphans.decisions.length} decision(s), ${trace.orphans.slices.length} slice(s), ${trace.orphans.reviews.length} review(s)`);
  }
  lines.push("");

  // Action items — what needs attention before this PR can be approved.
  const actions = [];
  if (!approved) {
    actions.push("Run `shipflow approve-pack` against the current pack hash.");
  }
  const unlinkedRows = trace.rows.filter(r => r.decision_count === 0);
  for (const r of unlinkedRows.slice(0, 5)) {
    actions.push(`Bind a decision to \`${r.vp}\` via \`shipflow decision link <id> --vp=${r.vp}\`.`);
  }
  if (openReviews > 0) {
    actions.push(`Resolve ${openReviews} open artifact review(s) before merging.`);
  }
  for (const d of trace.orphans.decisions) {
    actions.push(`Decision \`${d.id}\` has no \`impacts\` — link it to a vp file or mark superseded.`);
  }

  if (actions.length === 0) {
    lines.push("✅ **No outstanding actions before merge.**");
  } else {
    lines.push("**Before merging:**");
    for (const a of actions) lines.push(`- ${a}`);
  }
  lines.push("");

  // Per-vp condensed table
  if (totalRows > 0) {
    lines.push("<details><summary>VP coverage detail</summary>");
    lines.push("");
    lines.push("| VP file | Decisions | Slice | Open reviews |");
    lines.push("| --- | --- | --- | --- |");
    for (const r of trace.rows) {
      const dec = r.decisions.map(d => `\`${d.id}\``).join(", ") || "_none_";
      const slc = r.slices.map(s => `\`${s.id}\``).join(", ") || "_none_";
      const rev = r.open_review_count === 0 ? "0" : `**${r.open_review_count}**`;
      lines.push(`| \`${r.vp}\` | ${dec} | ${slc} | ${rev} |`);
    }
    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}

export function traceCli({ cwd, args = [], json = false }) {
  const flags = new Set(args.filter(a => a.startsWith("--")));
  const wantsMarkdown = flags.has("--markdown") || flags.has("--md");
  const wantsPrComment = flags.has("--pr-comment");
  const trace = buildTrace(cwd);
  if (json) {
    process.stdout.write(JSON.stringify(trace, null, 2) + "\n");
    return { exitCode: 0 };
  }
  if (wantsPrComment) {
    process.stdout.write(renderPrCommentTrace(trace) + "\n");
    return { exitCode: 0 };
  }
  if (wantsMarkdown) {
    process.stdout.write(renderMarkdownTrace(trace) + "\n");
    return { exitCode: 0 };
  }
  console.log(renderHumanTrace(trace));
  return { exitCode: 0 };
}
