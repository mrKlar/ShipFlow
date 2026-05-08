import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { Slice, SLICE_STATUSES } from "./schema/slice.zod.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { bold, dim, green, yellow, red } from "./util/color.js";
import { parseFlags, flagListAsArray, relPath } from "./util/cli.js";
import { findDecision } from "./decisions.js";
import { findGrillSession } from "./grill.js";

const SLICES_DIR = "slice";

export function slicesDir(cwd) {
  return path.join(cwd, SLICES_DIR);
}

export function listSliceFiles(cwd) {
  const dir = slicesDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(f => path.join(dir, f))
    .sort();
}

export function loadSlices(cwd) {
  const issues = [];
  const items = [];
  for (const file of listSliceFiles(cwd)) {
    let raw;
    try {
      raw = yaml.load(fs.readFileSync(file, "utf-8"));
    } catch (err) {
      issues.push({ file, code: "yaml.parse_error", message: String(err?.message || err) });
      continue;
    }
    try {
      const parsed = Slice.parse(raw);
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
      issues.push({ file: item.__file, code: "slice.duplicate_id", message: `Duplicate slice id: ${item.id}` });
    }
    ids.add(item.id);
  }
  return { items, issues };
}

export function findSlice(cwd, id) {
  const { items } = loadSlices(cwd);
  return items.find(s => s.id === id) || null;
}

function dumpSliceYaml(slice) {
  const ordered = {};
  const keys = ["id", "goal", "intent", "status", "vp", "decisions", "grill_refs", "evidence", "reviewer", "notes", "created_at", "updated_at"];
  for (const k of keys) if (slice[k] !== undefined) ordered[k] = slice[k];
  return yaml.dump(ordered, { lineWidth: 100, noRefs: true });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function dedupePush(arr, value) {
  if (!arr.includes(value)) arr.push(value);
}

export function createSlice(cwd, payload) {
  const data = {
    status: "proposed",
    vp: [],
    decisions: [],
    grill_refs: [],
    evidence: [],
    created_at: todayIso(),
    ...payload,
  };
  if (Array.isArray(data.vp)) data.vp = data.vp.map(normalizePath);
  const parsed = Slice.parse(data);
  const dir = slicesDir(cwd);
  mkdirp(dir);
  const { items } = loadSlices(cwd);
  if (items.some(s => s.id === parsed.id)) {
    throw new Error(`Slice id already exists: ${parsed.id}`);
  }
  const file = path.join(dir, `${parsed.id}.yml`);
  writeFile(file, dumpSliceYaml(parsed));
  return { file, slice: parsed };
}

export function updateSlice(cwd, id, mutate) {
  const slice = findSlice(cwd, id);
  if (!slice) throw new Error(`Slice not found: ${id}`);
  const next = { ...slice };
  delete next.__file;
  mutate(next);
  next.updated_at = new Date().toISOString();
  const parsed = Slice.parse(next);
  writeFile(slice.__file, dumpSliceYaml(parsed));
  return { file: slice.__file, slice: parsed };
}

export function linkSlice(cwd, id, additions) {
  return updateSlice(cwd, id, next => {
    if (additions.vp?.length) {
      next.vp = next.vp || [];
      for (const v of additions.vp) dedupePush(next.vp, normalizePath(v));
    }
    if (additions.decisions?.length) {
      next.decisions = next.decisions || [];
      for (const d of additions.decisions) {
        if (!findDecision(cwd, d)) {
          throw new Error(`Decision not found: ${d}`);
        }
        dedupePush(next.decisions, d);
      }
    }
    if (additions.grill_refs?.length) {
      next.grill_refs = next.grill_refs || [];
      for (const g of additions.grill_refs) {
        if (!findGrillSession(cwd, g)) {
          throw new Error(`Grill session not found: ${g}`);
        }
        dedupePush(next.grill_refs, g);
      }
    }
    if (additions.evidence?.length) {
      next.evidence = next.evidence || [];
      for (const e of additions.evidence) dedupePush(next.evidence, normalizePath(e));
    }
    if (additions.status) next.status = additions.status;
    if (additions.reviewer) next.reviewer = additions.reviewer;
    if (additions.notes) next.notes = additions.notes;
  });
}

export function unlinkSlice(cwd, id, removals) {
  return updateSlice(cwd, id, next => {
    if (removals.vp?.length) {
      const set = new Set(removals.vp.map(normalizePath));
      next.vp = (next.vp || []).filter(v => !set.has(v));
    }
    if (removals.decisions?.length) {
      const set = new Set(removals.decisions);
      next.decisions = (next.decisions || []).filter(d => !set.has(d));
    }
    if (removals.grill_refs?.length) {
      const set = new Set(removals.grill_refs);
      next.grill_refs = (next.grill_refs || []).filter(g => !set.has(g));
    }
    if (removals.evidence?.length) {
      const set = new Set(removals.evidence.map(normalizePath));
      next.evidence = (next.evidence || []).filter(e => !set.has(e));
    }
  });
}

export function deriveSliceProgress(cwd, slice) {
  const vpCount = (slice.vp || []).length;
  const vpPresent = (slice.vp || []).filter(v => fs.existsSync(path.join(cwd, v))).length;
  const evidencePresent = (slice.evidence || []).filter(e => fs.existsSync(path.join(cwd, e))).length;
  const decisionRefs = (slice.decisions || []).length;
  return {
    vp_total: vpCount,
    vp_present: vpPresent,
    vp_missing: vpCount - vpPresent,
    evidence_total: (slice.evidence || []).length,
    evidence_present: evidencePresent,
    decisions: decisionRefs,
    grill_refs: (slice.grill_refs || []).length,
    status: slice.status,
  };
}

export function slicesCli({ cwd, args, json = false }) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "list") {
    const { items, issues } = loadSlices(cwd);
    if (json) {
      process.stdout.write(JSON.stringify({
        slices: items.map(s => ({
          ...s,
          __file: relPath(cwd, s.__file),
          progress: deriveSliceProgress(cwd, s),
        })),
        issues: issues.map(i => ({ ...i, file: relPath(cwd, i.file) })),
      }, null, 2) + "\n");
      return { exitCode: issues.length ? 1 : 0 };
    }
    if (items.length === 0 && issues.length === 0) {
      console.log(dim("No slices yet. Run `shipflow slice new` to define one."));
      return { exitCode: 0 };
    }
    console.log(bold(`Slices (${items.length})`));
    for (const s of items) {
      const p = deriveSliceProgress(cwd, s);
      const tag = s.status === "verified" || s.status === "shipped" ? green(s.status)
        : s.status === "in-progress" || s.status === "implemented" ? yellow(s.status)
        : s.status === "abandoned" ? red(s.status)
        : dim(s.status);
      console.log(`  ${bold(s.id)}  ${tag}`);
      console.log(`    ${s.goal}`);
      console.log(dim(`    vp: ${p.vp_present}/${p.vp_total}  decisions: ${p.decisions}  grill: ${p.grill_refs}  evidence: ${p.evidence_present}/${p.evidence_total}`));
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
      console.error("usage: shipflow slice show <id>");
      return { exitCode: 2 };
    }
    const slice = findSlice(cwd, id);
    if (!slice) {
      console.error(`Slice not found: ${id}`);
      return { exitCode: 1 };
    }
    const progress = deriveSliceProgress(cwd, slice);
    if (json) {
      process.stdout.write(JSON.stringify({ ...slice, __file: relPath(cwd, slice.__file), progress }, null, 2) + "\n");
      return { exitCode: 0 };
    }
    console.log(bold(slice.id));
    console.log(`  goal:     ${slice.goal}`);
    if (slice.intent) console.log(`  intent:   ${slice.intent}`);
    console.log(`  status:   ${slice.status}`);
    if (slice.vp.length) {
      console.log(`  vp:`);
      for (const v of slice.vp) {
        const present = fs.existsSync(path.join(cwd, v)) ? green("✓") : red("✗");
        console.log(`    ${present} ${v}`);
      }
    }
    if (slice.decisions.length) {
      console.log(`  decisions: ${slice.decisions.join(", ")}`);
    }
    if (slice.grill_refs.length) {
      console.log(`  grill:     ${slice.grill_refs.join(", ")}`);
    }
    if (slice.evidence.length) {
      console.log(`  evidence:`);
      for (const e of slice.evidence) {
        const present = fs.existsSync(path.join(cwd, e)) ? green("✓") : red("✗");
        console.log(`    ${present} ${e}`);
      }
    }
    if (slice.reviewer) console.log(`  reviewer: ${slice.reviewer}`);
    if (slice.notes) console.log(`  notes:    ${slice.notes}`);
    console.log(dim(`  file:     ${relPath(cwd, slice.__file)}`));
    console.log(dim(`  progress: vp ${progress.vp_present}/${progress.vp_total}, evidence ${progress.evidence_present}/${progress.evidence_total}`));
    return { exitCode: 0 };
  }

  if (sub === "new") {
    const flags = parseFlags(rest);
    const required = ["id", "goal"];
    const missing = required.filter(k => !flags[k]);
    if (missing.length) {
      console.error(`Missing required flags for shipflow slice new: ${missing.map(k => `--${k}`).join(", ")}`);
      console.error('usage: shipflow slice new --id=<kebab-id> --goal="..." [--intent="..."] [--status=proposed|planned|in-progress|implemented|verified|shipped|abandoned] [--vp=...] [--decision=...] [--grill=...] [--reviewer=...] [--notes=...]');
      return { exitCode: 2 };
    }
    const payload = {
      id: flags.id,
      goal: flags.goal,
      vp: flagListAsArray(flags, "vp"),
      decisions: flagListAsArray(flags, "decision"),
      grill_refs: flagListAsArray(flags, "grill"),
      evidence: flagListAsArray(flags, "evidence"),
    };
    if (flags.intent) payload.intent = flags.intent;
    if (flags.status) payload.status = flags.status;
    if (flags.reviewer) payload.reviewer = flags.reviewer;
    if (flags.notes) payload.notes = flags.notes;
    try {
      const { file, slice } = createSlice(cwd, payload);
      if (json) {
        process.stdout.write(JSON.stringify({ created: relPath(cwd, file), slice }, null, 2) + "\n");
      } else {
        console.log(green(`Slice created: ${slice.id}`));
        console.log(dim(`  ${relPath(cwd, file)}`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  if (sub === "link" || sub === "unlink") {
    const id = rest.find(a => !a.startsWith("--"));
    const flags = parseFlags(rest);
    if (!id) {
      console.error(`usage: shipflow slice ${sub} <id> [--vp=...] [--decision=...] [--grill=...] [--evidence=...] [--status=...] [--reviewer=...] [--notes=...]`);
      return { exitCode: 2 };
    }
    const payload = {
      vp: flagListAsArray(flags, "vp"),
      decisions: flagListAsArray(flags, "decision"),
      grill_refs: flagListAsArray(flags, "grill"),
      evidence: flagListAsArray(flags, "evidence"),
    };
    if (sub === "link") {
      if (flags.status) payload.status = flags.status;
      if (flags.reviewer) payload.reviewer = flags.reviewer;
      if (flags.notes) payload.notes = flags.notes;
    }
    try {
      const { slice } = sub === "link" ? linkSlice(cwd, id, payload) : unlinkSlice(cwd, id, payload);
      if (json) {
        process.stdout.write(JSON.stringify({ slice }, null, 2) + "\n");
      } else {
        console.log(green(`${sub === "link" ? "Updated" : "Unlinked"} slice ${slice.id}`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  if (sub === "set-status") {
    const id = rest.find(a => !a.startsWith("--"));
    const flags = parseFlags(rest);
    if (!id || !flags.status) {
      console.error(`usage: shipflow slice set-status <id> --status=${SLICE_STATUSES.join("|")}`);
      return { exitCode: 2 };
    }
    if (!SLICE_STATUSES.includes(flags.status)) {
      console.error(`--status must be one of: ${SLICE_STATUSES.join(", ")}`);
      return { exitCode: 2 };
    }
    try {
      const { slice } = updateSlice(cwd, id, next => { next.status = flags.status; });
      if (json) {
        process.stdout.write(JSON.stringify({ slice }, null, 2) + "\n");
      } else {
        console.log(green(`Slice ${slice.id} status: ${slice.status}`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  console.error(`Unknown slice subcommand: ${sub}`);
  console.error("Available: list, show, new, link, unlink, set-status");
  return { exitCode: 2 };
}
