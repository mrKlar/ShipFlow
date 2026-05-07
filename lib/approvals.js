import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Approval, APPROVAL_ROLES } from "./schema/approval.zod.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { bold, dim, green, yellow, red } from "./util/color.js";
import { computeVerificationPackSnapshot } from "./util/vp-snapshot.js";

const APPROVALS_DIR = path.join(".shipflow", "approvals");

export function approvalsDir(cwd) {
  return path.join(cwd, APPROVALS_DIR);
}

export function listApprovalFiles(cwd) {
  const dir = approvalsDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => path.join(dir, f))
    .sort();
}

export function loadApprovals(cwd) {
  const issues = [];
  const items = [];
  for (const file of listApprovalFiles(cwd)) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err) {
      issues.push({ file, code: "json.parse_error", message: String(err?.message || err) });
      continue;
    }
    try {
      const parsed = Approval.parse(raw);
      items.push({ ...parsed, __file: file });
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
    }
  }
  // Sort by approved_at to get latest reliably regardless of filename.
  items.sort((a, b) => String(a.approved_at).localeCompare(String(b.approved_at)));
  return { items, issues };
}

export function activeApprovals(cwd) {
  const { items } = loadApprovals(cwd);
  return items.filter(a => !a.revoked_at);
}

export function currentPackHash(cwd) {
  return computeVerificationPackSnapshot(cwd).vp_sha256;
}

export function isPackApproved(cwd) {
  const hash = currentPackHash(cwd);
  const active = activeApprovals(cwd);
  const matching = active.filter(a => a.pack_sha256 === hash);
  return {
    approved: matching.length > 0,
    pack_sha256: hash,
    matching_approvals: matching,
    latest: active.length > 0 ? active[active.length - 1] : null,
  };
}

function approverDefault() {
  return process.env.SHIPFLOW_APPROVER
    || process.env.GIT_AUTHOR_NAME
    || process.env.USER
    || process.env.LOGNAME
    || "unknown";
}

function timestampStamp(date = new Date()) {
  const iso = date.toISOString();
  return iso.replace(/[:T]/g, "-").replace(/\..+$/, "Z");
}

export function approvePack(cwd, payload = {}) {
  const snapshot = computeVerificationPackSnapshot(cwd);
  if (!snapshot.files.length) {
    throw new Error("Cannot approve an empty verification pack. Add at least one vp/**/*.{yml,rego} first.");
  }
  const approvedAt = payload.approved_at || new Date().toISOString();
  const role = payload.role || "architect";
  const id = payload.id || `${timestampStamp(new Date(approvedAt))}-${role}`;
  const draft = {
    id,
    pack_sha256: snapshot.vp_sha256,
    approved_by: payload.approver || approverDefault(),
    approved_at: approvedAt,
    role,
    scope: payload.scope,
    slice: payload.slice,
    decision_refs: payload.decision_refs || [],
    grill_refs: payload.grill_refs || [],
    notes: payload.notes,
  };
  for (const k of Object.keys(draft)) {
    if (draft[k] === undefined) delete draft[k];
  }
  const parsed = Approval.parse(draft);
  const dir = approvalsDir(cwd);
  mkdirp(dir);
  const file = path.join(dir, `${parsed.id}.json`);
  if (fs.existsSync(file)) {
    throw new Error(`Approval id collision: ${parsed.id}`);
  }
  writeFile(file, JSON.stringify(parsed, null, 2) + "\n");
  return { file, approval: parsed, snapshot };
}

export function revokeApproval(cwd, id, reason) {
  const { items } = loadApprovals(cwd);
  const target = items.find(a => a.id === id);
  if (!target) throw new Error(`Approval not found: ${id}`);
  if (target.revoked_at) return { file: target.__file, approval: target, alreadyRevoked: true };
  const next = { ...target };
  delete next.__file;
  next.revoked_at = new Date().toISOString();
  if (reason) next.revoked_reason = reason;
  const parsed = Approval.parse(next);
  writeFile(target.__file, JSON.stringify(parsed, null, 2) + "\n");
  return { file: target.__file, approval: parsed };
}

function relPath(cwd, file) {
  return path.relative(cwd, file).replaceAll("\\", "/");
}

function parseFlags(args) {
  const flags = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) {
        flags[arg.slice(2)] = true;
      } else {
        const key = arg.slice(2, eq);
        const val = arg.slice(eq + 1);
        if (flags[key] === undefined) flags[key] = val;
        else if (Array.isArray(flags[key])) flags[key].push(val);
        else flags[key] = [flags[key], val];
      }
    }
  }
  return flags;
}

function ensureArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function approvalsCli({ cwd, args, json = false }) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "status") {
    const status = isPackApproved(cwd);
    if (json) {
      process.stdout.write(JSON.stringify({
        ...status,
        matching_approvals: status.matching_approvals.map(a => ({ ...a, __file: relPath(cwd, a.__file) })),
        latest: status.latest ? { ...status.latest, __file: relPath(cwd, status.latest.__file) } : null,
      }, null, 2) + "\n");
      return { exitCode: 0 };
    }
    console.log(bold("Pack approval status"));
    console.log(`  Current vp sha256: ${status.pack_sha256}`);
    if (status.approved) {
      console.log(green(`  Approved by ${status.matching_approvals.length} active approval(s):`));
      for (const a of status.matching_approvals) {
        console.log(`    ${a.id} — ${a.approved_by} (${a.role}) @ ${a.approved_at}`);
      }
    } else if (status.latest) {
      console.log(yellow("  Pack is NOT currently approved."));
      console.log(dim(`  Latest approval: ${status.latest.id} matches sha ${status.latest.pack_sha256.slice(0, 12)}…`));
      console.log(dim(`  Re-approve with: shipflow approve-pack`));
    } else {
      console.log(yellow("  Pack is NOT currently approved (no approvals on file)."));
      console.log(dim("  Approve with: shipflow approve-pack"));
    }
    return { exitCode: 0 };
  }

  if (sub === "list") {
    const { items, issues } = loadApprovals(cwd);
    if (json) {
      process.stdout.write(JSON.stringify({
        approvals: items.map(a => ({ ...a, __file: relPath(cwd, a.__file) })),
        issues: issues.map(i => ({ ...i, file: relPath(cwd, i.file) })),
      }, null, 2) + "\n");
      return { exitCode: issues.length ? 1 : 0 };
    }
    if (items.length === 0) {
      console.log(dim("No approvals yet. Run `shipflow approve-pack` to record one."));
      return { exitCode: 0 };
    }
    console.log(bold(`Approvals (${items.length})`));
    for (const a of items) {
      const tag = a.revoked_at ? red("revoked") : green("active");
      console.log(`  ${bold(a.id)}  ${tag}  ${dim(`[${a.role}]`)}`);
      console.log(`    ${a.approved_by} @ ${a.approved_at}`);
      console.log(dim(`    sha: ${a.pack_sha256.slice(0, 16)}…  scope: ${a.scope || "(pack)"}`));
      if (a.revoked_at) console.log(dim(`    revoked at ${a.revoked_at}${a.revoked_reason ? ` — ${a.revoked_reason}` : ""}`));
    }
    if (issues.length) {
      console.log(red(`Issues (${issues.length}):`));
      for (const i of issues) console.log(`  ${relPath(cwd, i.file)}: ${i.code}: ${i.message}`);
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (sub === "show") {
    const id = rest.find(a => !a.startsWith("--"));
    if (!id) {
      console.error("usage: shipflow approve-pack show <id>");
      return { exitCode: 2 };
    }
    const { items } = loadApprovals(cwd);
    const a = items.find(x => x.id === id);
    if (!a) {
      console.error(`Approval not found: ${id}`);
      return { exitCode: 1 };
    }
    if (json) {
      process.stdout.write(JSON.stringify({ ...a, __file: relPath(cwd, a.__file) }, null, 2) + "\n");
      return { exitCode: 0 };
    }
    console.log(JSON.stringify(a, null, 2));
    return { exitCode: 0 };
  }

  if (sub === "revoke") {
    const id = rest.find(a => !a.startsWith("--"));
    const flags = parseFlags(rest);
    if (!id) {
      console.error("usage: shipflow approve-pack revoke <id> [--reason=...]");
      return { exitCode: 2 };
    }
    try {
      const { approval } = revokeApproval(cwd, id, flags.reason);
      if (json) {
        process.stdout.write(JSON.stringify({ approval }, null, 2) + "\n");
      } else {
        console.log(yellow(`Revoked approval ${approval.id}`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  // Default action / sub === "new" / sub === "approve" / no subcommand: record a new approval.
  const isNewAction = !sub || sub === "new" || sub === "approve" || sub.startsWith("--");
  if (isNewAction) {
    // If sub is a flag, include it back in for parsing.
    const inputArgs = sub && sub.startsWith("--") ? args : rest;
    const flags = parseFlags(inputArgs);
    if (flags.role && !APPROVAL_ROLES.includes(flags.role)) {
      console.error(`--role must be one of: ${APPROVAL_ROLES.join(", ")}`);
      return { exitCode: 2 };
    }
    const decisionRefs = ensureArray(flags["decision-ref"])
      .flatMap(v => String(v).split(","))
      .map(s => s.trim())
      .filter(Boolean);
    const grillRefs = ensureArray(flags["grill-ref"])
      .flatMap(v => String(v).split(","))
      .map(s => s.trim())
      .filter(Boolean);
    try {
      const { approval, file } = approvePack(cwd, {
        approver: flags.approver,
        role: flags.role,
        scope: flags.scope,
        slice: flags.slice,
        notes: flags.notes,
        decision_refs: decisionRefs,
        grill_refs: grillRefs,
      });
      if (json) {
        process.stdout.write(JSON.stringify({ approval, file: relPath(cwd, file) }, null, 2) + "\n");
      } else {
        console.log(green(`Pack approved: ${approval.id}`));
        console.log(dim(`  by ${approval.approved_by} (${approval.role}) @ ${approval.approved_at}`));
        console.log(dim(`  pack sha: ${approval.pack_sha256}`));
        console.log(dim(`  ${relPath(cwd, file)}`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  console.error(`Unknown approve-pack subcommand: ${sub}`);
  return { exitCode: 2 };
}

export function isApprovalRequired(cwd, deps = {}) {
  const readConfig = deps.readConfig || (() => {
    try { return JSON.parse(fs.readFileSync(path.join(cwd, "shipflow.json"), "utf-8")); }
    catch { return {}; }
  });
  const env = deps.env || process.env;
  if (env.SHIPFLOW_REQUIRE_APPROVAL === "1" || env.SHIPFLOW_REQUIRE_APPROVAL === "true") return true;
  if (env.SHIPFLOW_REQUIRE_APPROVAL === "0" || env.SHIPFLOW_REQUIRE_APPROVAL === "false") return false;
  const config = readConfig(cwd);
  return Boolean(config?.impl?.requirePackApproval);
}

export function summarizeApprovalGate(cwd, deps = {}) {
  const required = isApprovalRequired(cwd, deps);
  const status = isPackApproved(cwd);
  const blocking = [];
  if (required && !status.approved) {
    if (status.latest) {
      blocking.push("Verification pack has changed since the latest approval. Re-approve with shipflow approve-pack before implement.");
    } else {
      blocking.push("Verification pack is not approved. Approve with shipflow approve-pack before implement.");
    }
  }
  return {
    required,
    approved: status.approved,
    pack_sha256: status.pack_sha256,
    matching_approvals: status.matching_approvals.length,
    latest: status.latest ? {
      id: status.latest.id,
      approved_by: status.latest.approved_by,
      role: status.latest.role,
      approved_at: status.latest.approved_at,
      pack_sha256: status.latest.pack_sha256,
    } : null,
    blocking_reasons: blocking,
  };
}
