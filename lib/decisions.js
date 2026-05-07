import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { Decision, DECISION_TYPES, DECISION_STATUSES, DECISION_SOURCES } from "./schema/decision.zod.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { bold, dim, green, yellow, red } from "./util/color.js";

const DECISIONS_DIR = path.join(".shipflow", "decisions");

export function decisionsDir(cwd) {
  return path.join(cwd, DECISIONS_DIR);
}

export function listDecisionFiles(cwd) {
  const dir = decisionsDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(f => path.join(dir, f))
    .sort();
}

export function loadDecisions(cwd) {
  const issues = [];
  const items = [];
  for (const file of listDecisionFiles(cwd)) {
    let raw;
    try {
      raw = yaml.load(fs.readFileSync(file, "utf-8"));
    } catch (err) {
      issues.push({ file, code: "yaml.parse_error", message: String(err?.message || err) });
      continue;
    }
    try {
      const parsed = Decision.parse(raw);
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
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) {
      issues.push({ file: item.__file, code: "decision.duplicate_id", message: `Duplicate decision id: ${item.id}` });
    }
    ids.add(item.id);
  }
  return { items, issues };
}

export function findDecision(cwd, id) {
  const { items } = loadDecisions(cwd);
  return items.find(d => d.id === id) || null;
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "decision";
}

function nextNumericPrefix(cwd) {
  const files = listDecisionFiles(cwd);
  let max = 0;
  for (const f of files) {
    const base = path.basename(f);
    const m = base.match(/^(\d{4})-/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return String(max + 1).padStart(4, "0");
}

export function decisionFileName(cwd, id) {
  return `${nextNumericPrefix(cwd)}-${slugify(id)}.yml`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dumpDecisionYaml(decision) {
  const ordered = {};
  const keys = [
    "id",
    "type",
    "status",
    "title",
    "question",
    "decision",
    "rationale",
    "source",
    "source_ref",
    "impacts",
    "supersedes",
    "superseded_by",
    "decided_by",
    "decided_at",
    "notes",
  ];
  for (const k of keys) if (decision[k] !== undefined) ordered[k] = decision[k];
  return yaml.dump(ordered, { lineWidth: 100, noRefs: true });
}

export function createDecision(cwd, payload) {
  const data = {
    type: "product",
    status: "accepted",
    source: "manual",
    impacts: [],
    decided_at: todayIso(),
    ...payload,
  };
  const parsed = Decision.parse(data);
  const dir = decisionsDir(cwd);
  mkdirp(dir);
  const { items } = loadDecisions(cwd);
  if (items.some(d => d.id === parsed.id)) {
    throw new Error(`Decision id already exists: ${parsed.id}`);
  }
  const file = path.join(dir, decisionFileName(cwd, parsed.id));
  writeFile(file, dumpDecisionYaml(parsed));
  return { file, decision: parsed };
}

export function linkDecisionImpact(cwd, id, vpFile) {
  const decision = findDecision(cwd, id);
  if (!decision) throw new Error(`Decision not found: ${id}`);
  const file = decision.__file;
  const next = { ...decision };
  delete next.__file;
  if (!next.impacts) next.impacts = [];
  const normalized = vpFile.replaceAll("\\", "/");
  if (!next.impacts.includes(normalized)) {
    next.impacts.push(normalized);
  }
  writeFile(file, dumpDecisionYaml(next));
  return { file, decision: next };
}

export function unlinkDecisionImpact(cwd, id, vpFile) {
  const decision = findDecision(cwd, id);
  if (!decision) throw new Error(`Decision not found: ${id}`);
  const file = decision.__file;
  const next = { ...decision };
  delete next.__file;
  const normalized = vpFile.replaceAll("\\", "/");
  next.impacts = (next.impacts || []).filter(p => p !== normalized);
  writeFile(file, dumpDecisionYaml(next));
  return { file, decision: next };
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

function relPath(cwd, file) {
  return path.relative(cwd, file).replaceAll("\\", "/");
}

export function decisionsCli({ cwd, args, json = false }) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "list") {
    const { items, issues } = loadDecisions(cwd);
    if (json) {
      process.stdout.write(JSON.stringify({
        decisions: items.map(d => ({ ...d, __file: relPath(cwd, d.__file) })),
        issues: issues.map(i => ({ ...i, file: relPath(cwd, i.file) })),
      }, null, 2) + "\n");
      return { exitCode: issues.length > 0 ? 1 : 0 };
    }
    if (items.length === 0 && issues.length === 0) {
      console.log(dim("No decisions yet. Use `shipflow decision new` to record one."));
      return { exitCode: 0 };
    }
    console.log(bold(`Decisions (${items.length})`));
    for (const d of items) {
      const status = d.status === "accepted" ? green(d.status)
        : d.status === "superseded" ? yellow(d.status)
        : d.status === "rejected" ? red(d.status)
        : dim(d.status);
      console.log(`  ${bold(d.id)}  ${dim(`[${d.type}]`)}  ${status}`);
      console.log(`    ${d.title}`);
      if (d.impacts?.length) {
        console.log(dim(`    impacts: ${d.impacts.join(", ")}`));
      }
    }
    if (issues.length > 0) {
      console.log("");
      console.log(red(`Issues (${issues.length}):`));
      for (const issue of issues) {
        console.log(`  ${relPath(cwd, issue.file)}: ${issue.code}: ${issue.message}`);
      }
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (sub === "show") {
    const id = rest.find(a => !a.startsWith("--"));
    if (!id) {
      console.error("usage: shipflow decision show <id>");
      return { exitCode: 2 };
    }
    const decision = findDecision(cwd, id);
    if (!decision) {
      console.error(`Decision not found: ${id}`);
      return { exitCode: 1 };
    }
    if (json) {
      process.stdout.write(JSON.stringify({ ...decision, __file: relPath(cwd, decision.__file) }, null, 2) + "\n");
      return { exitCode: 0 };
    }
    console.log(bold(decision.id));
    console.log(`  type: ${decision.type}`);
    console.log(`  status: ${decision.status}`);
    console.log(`  title: ${decision.title}`);
    console.log(`  question: ${decision.question}`);
    console.log(`  decision: ${decision.decision}`);
    console.log(`  rationale: ${decision.rationale}`);
    console.log(`  source: ${decision.source}${decision.source_ref ? ` (${decision.source_ref})` : ""}`);
    if (decision.impacts?.length) {
      console.log(`  impacts:`);
      for (const i of decision.impacts) console.log(`    - ${i}`);
    }
    if (decision.decided_by) console.log(`  decided_by: ${decision.decided_by}`);
    if (decision.decided_at) console.log(`  decided_at: ${decision.decided_at}`);
    if (decision.supersedes) console.log(`  supersedes: ${decision.supersedes}`);
    if (decision.superseded_by) console.log(`  superseded_by: ${decision.superseded_by}`);
    if (decision.notes) console.log(`  notes: ${decision.notes}`);
    console.log(dim(`  file: ${relPath(cwd, decision.__file)}`));
    return { exitCode: 0 };
  }

  if (sub === "new") {
    const flags = parseFlags(rest);
    const required = ["id", "title", "question", "decision", "rationale"];
    const missing = required.filter(k => !flags[k]);
    if (missing.length) {
      console.error(`Missing required flags for shipflow decision new: ${missing.map(k => `--${k}`).join(", ")}`);
      console.error(`Usage: shipflow decision new --id=<id> --title="..." --question="..." --decision="..." --rationale="..." [--type=${DECISION_TYPES.join("|")}] [--status=${DECISION_STATUSES.join("|")}] [--source=${DECISION_SOURCES.join("|")}] [--source-ref=...] [--impacts=path] [--decided-by=...] [--notes=...]`);
      return { exitCode: 2 };
    }
    const payload = {
      id: flags.id,
      title: flags.title,
      question: flags.question,
      decision: flags.decision,
      rationale: flags.rationale,
    };
    if (flags.type) payload.type = flags.type;
    if (flags.status) payload.status = flags.status;
    if (flags.source) payload.source = flags.source;
    if (flags["source-ref"]) payload.source_ref = flags["source-ref"];
    if (flags["decided-by"]) payload.decided_by = flags["decided-by"];
    if (flags["decided-at"]) payload.decided_at = flags["decided-at"];
    if (flags.supersedes) payload.supersedes = flags.supersedes;
    if (flags.notes) payload.notes = flags.notes;
    const impacts = ensureArray(flags.impacts).flatMap(v => String(v).split(",")).map(s => s.trim()).filter(Boolean);
    if (impacts.length) payload.impacts = impacts;

    try {
      const { file, decision } = createDecision(cwd, payload);
      if (json) {
        process.stdout.write(JSON.stringify({ created: relPath(cwd, file), decision }, null, 2) + "\n");
      } else {
        console.log(green(`Decision recorded: ${decision.id}`));
        console.log(dim(`  ${relPath(cwd, file)}`));
      }
      return { exitCode: 0 };
    } catch (err) {
      if (err instanceof z.ZodError) {
        for (const issue of err.issues) {
          console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
        }
        return { exitCode: 1 };
      }
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  if (sub === "link" || sub === "unlink") {
    const id = rest.find(a => !a.startsWith("--"));
    const flags = parseFlags(rest);
    const vpFiles = ensureArray(flags.vp).flatMap(v => String(v).split(",")).map(s => s.trim()).filter(Boolean);
    if (!id || vpFiles.length === 0) {
      console.error(`usage: shipflow decision ${sub} <id> --vp=<vp/path/file.yml>`);
      return { exitCode: 2 };
    }
    try {
      let lastResult;
      for (const vp of vpFiles) {
        lastResult = sub === "link"
          ? linkDecisionImpact(cwd, id, vp)
          : unlinkDecisionImpact(cwd, id, vp);
      }
      if (json) {
        process.stdout.write(JSON.stringify({
          file: relPath(cwd, lastResult.file),
          decision: lastResult.decision,
        }, null, 2) + "\n");
      } else {
        console.log(green(`${sub === "link" ? "Linked" : "Unlinked"} ${vpFiles.join(", ")} ${sub === "link" ? "to" : "from"} ${id}`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  console.error(`Unknown decision subcommand: ${sub}`);
  console.error(`Available: list, show, new, link, unlink`);
  return { exitCode: 2 };
}
