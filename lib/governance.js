import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { Governance } from "./schema/governance.zod.js";
import { writeFile } from "./util/fs.js";
import { bold, dim, green, yellow, red } from "./util/color.js";
import { relPath } from "./util/cli.js";
import { loadDecisions } from "./decisions.js";
import { loadGrillSessions } from "./grill.js";
import { loadApprovals, currentPackHash, isApprovalRequired } from "./approvals.js";
import { loadReviews } from "./reviews.js";
import { runCritique } from "./critique.js";
import { buildTrace } from "./trace.js";

const GOVERNANCE_FILE = path.join(".shipflow", "governance.yml");

export function governanceFile(cwd) {
  return path.join(cwd, GOVERNANCE_FILE);
}

export function loadGovernance(cwd) {
  const file = governanceFile(cwd);
  if (!fs.existsSync(file)) {
    return { policy: null, file, present: false, issues: [] };
  }
  let raw;
  const issues = [];
  try {
    raw = yaml.load(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    issues.push({ file, code: "yaml.parse_error", message: String(err?.message || err) });
    return { policy: null, file, present: true, issues };
  }
  try {
    const policy = Governance.parse(raw || {});
    return { policy, file, present: true, issues };
  } catch (err) {
    if (err instanceof z.ZodError) {
      for (const issue of err.issues) {
        issues.push({
          file,
          code: "schema.invalid",
          message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        });
      }
    } else {
      issues.push({ file, code: "schema.invalid", message: String(err?.message || err) });
    }
    return { policy: null, file, present: true, issues };
  }
}

const DEFAULT_TEMPLATE = `# ShipFlow governance policy
# Edit values to enforce organizational policy on the verification pack.
#
# This file expresses what "approved" means for your team. The
# shipflow governance check command validates the current state of
# the repo against it.
version: 1

# Mirrors shipflow.json -> impl.requirePackApproval (env or flag still wins).
require_pack_approval: false

# Roles that MUST each have at least one active approval against the
# current pack hash. Use [] to disable.
required_approver_roles: []

# Grill role lenses that MUST have at least one session on file before
# governance check passes. Use [] to disable.
required_grill_roles: []

# Each vp file must be backed by at least this many decisions.
min_decisions_per_vp: 0

# Fail governance if the critique heuristics flag happy_path_only or
# *_no_negative cases.
require_negative_cases: false

# Fail governance if any decision has empty impacts.
forbid_orphan_decisions: false

# Fail governance if any artifact review is in 'open' status.
forbid_open_reviews: false

# Optional human-readable note about why this policy exists.
notes: ""
`;

export function writeDefaultGovernance(cwd) {
  const file = governanceFile(cwd);
  if (fs.existsSync(file)) {
    return { file, written: false };
  }
  writeFile(file, DEFAULT_TEMPLATE);
  return { file, written: true };
}

export function runGovernanceCheck(cwd) {
  const { policy, file, present, issues: loadIssues } = loadGovernance(cwd);
  const findings = [...loadIssues];

  function add(code, message, level = "error") {
    findings.push({ level, code, message });
  }

  if (!present) {
    add("governance.no_policy", "No .shipflow/governance.yml on file. Run shipflow governance init to scaffold one.", "warn");
  }

  // Single-pass load: hoist every collection once and reuse.
  const decisions = loadDecisions(cwd).items;
  const grillSessions = loadGrillSessions(cwd).items;
  const approvals = loadApprovals(cwd).items;
  const reviews = loadReviews(cwd).items;
  const trace = buildTrace(cwd, { decisions, grillSessions, approvals, reviews });

  if (policy?.require_pack_approval) {
    if (trace.approval.length === 0) {
      add("governance.unapproved_pack", `require_pack_approval is true but no active approval matches the current pack sha (${trace.pack_sha256.slice(0, 12)}…).`);
    }
  }

  if (policy?.required_approver_roles?.length) {
    const haveRoles = new Set(trace.approval.map(a => a.role));
    const missing = policy.required_approver_roles.filter(r => !haveRoles.has(r));
    if (missing.length > 0) {
      add("governance.missing_approver_role", `Required approver role(s) without active approval: ${missing.join(", ")}.`);
    }
  }

  if (policy?.required_grill_roles?.length) {
    const haveRoles = new Set(grillSessions.map(s => s.role));
    const missing = policy.required_grill_roles.filter(r => !haveRoles.has(r));
    if (missing.length > 0) {
      add("governance.missing_grill_role", `Required grill role(s) with no session on file: ${missing.join(", ")}.`);
    }
  }

  if (policy?.min_decisions_per_vp && policy.min_decisions_per_vp > 0) {
    for (const row of trace.rows) {
      if (row.decision_count < policy.min_decisions_per_vp) {
        add(
          "governance.under_decisioned",
          `${row.vp} has ${row.decision_count} decision(s) bound but ${policy.min_decisions_per_vp} required.`,
        );
      }
    }
  }

  if (policy?.require_negative_cases) {
    const critique = runCritique(cwd);
    const flagged = (critique.findings || []).filter(f =>
      f.code === "critique.happy_path_only"
      || f.code === "critique.behavior_no_negative"
      || f.code === "critique.api_no_negative"
      || f.code === "critique.security_no_negative",
    );
    for (const f of flagged) {
      add("governance.missing_negative_case", `${f.code}: ${f.message}`);
    }
  }

  if (policy?.forbid_orphan_decisions) {
    if (trace.orphans.decisions.length > 0) {
      add(
        "governance.orphan_decision",
        `${trace.orphans.decisions.length} decision(s) without vp impact: ${trace.orphans.decisions.map(d => d.id).join(", ")}.`,
      );
    }
  }

  if (policy?.forbid_open_reviews) {
    const open = reviews.filter(r => r.status === "open");
    if (open.length > 0) {
      add(
        "governance.open_reviews",
        `${open.length} artifact review(s) in 'open' status: ${open.map(r => r.id).join(", ")}.`,
      );
    }
  }

  const errors = findings.filter(f => f.level === "error").length;
  return {
    ok: errors === 0,
    file,
    policy_present: present,
    policy,
    findings,
    summary: {
      errors,
      warnings: findings.filter(f => f.level === "warn").length,
    },
  };
}

export function governanceCli({ cwd, args = [], json = false }) {
  const sub = args[0];

  if (!sub || sub === "check") {
    const result = runGovernanceCheck(cwd);
    if (json) {
      process.stdout.write(JSON.stringify({
        ...result,
        file: relPath(cwd, result.file),
      }, null, 2) + "\n");
      return { exitCode: result.ok ? 0 : 1 };
    }
    console.log(bold("Governance check"));
    if (result.policy_present) {
      console.log(dim(`  policy: ${relPath(cwd, result.file)}`));
    } else {
      console.log(yellow(`  policy: not found (${relPath(cwd, result.file)}) — run shipflow governance init`));
    }
    console.log(`  status: ${result.ok ? green("PASS") : red("FAIL")}`);
    console.log(`  findings: ${result.findings.length} (${result.summary.errors} error, ${result.summary.warnings} warn)`);
    if (result.findings.length) {
      console.log("");
      for (const f of result.findings) {
        const tag = f.level === "error" ? red("error") : yellow("warn");
        console.log(`  [${tag}] ${f.code}: ${f.message}`);
      }
    }
    return { exitCode: result.ok ? 0 : 1 };
  }

  if (sub === "init") {
    const { file, written } = writeDefaultGovernance(cwd);
    if (written) {
      console.log(green(`Wrote ${relPath(cwd, file)}`));
      console.log(dim("Edit it to match your organization's policy."));
    } else {
      console.log(yellow(`${relPath(cwd, file)} already exists. Edit it directly.`));
    }
    return { exitCode: 0 };
  }

  if (sub === "show") {
    const { policy, file, present, issues } = loadGovernance(cwd);
    if (json) {
      process.stdout.write(JSON.stringify({ policy, file: relPath(cwd, file), present, issues }, null, 2) + "\n");
      return { exitCode: issues.length ? 1 : 0 };
    }
    if (!present) {
      console.log(yellow(`No policy found at ${relPath(cwd, file)}`));
      return { exitCode: 0 };
    }
    if (!policy) {
      console.log(red(`Policy is invalid:`));
      for (const i of issues) console.log(`  ${i.code}: ${i.message}`);
      return { exitCode: 1 };
    }
    console.log(JSON.stringify(policy, null, 2));
    return { exitCode: 0 };
  }

  console.error(`Unknown governance subcommand: ${sub}`);
  console.error("Available: check (default), init, show");
  return { exitCode: 2 };
}
