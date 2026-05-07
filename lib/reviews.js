import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { ArtifactReview, REVIEW_KINDS, REVIEW_STATUSES, REVIEW_TARGET_KINDS } from "./schema/review.zod.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { bold, dim, green, yellow, red } from "./util/color.js";
import { loadSlices } from "./slices.js";
import { loadDecisions } from "./decisions.js";

const REVIEWS_DIR = path.join(".shipflow", "reviews");

export function reviewsDir(cwd) {
  return path.join(cwd, REVIEWS_DIR);
}

export function listReviewFiles(cwd) {
  const dir = reviewsDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(f => path.join(dir, f))
    .sort();
}

export function loadReviews(cwd) {
  const issues = [];
  const items = [];
  for (const file of listReviewFiles(cwd)) {
    let raw;
    try {
      raw = yaml.load(fs.readFileSync(file, "utf-8"));
    } catch (err) {
      issues.push({ file, code: "yaml.parse_error", message: String(err?.message || err) });
      continue;
    }
    try {
      const parsed = ArtifactReview.parse(raw);
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
  return { items, issues };
}

export function findReview(cwd, id) {
  const { items } = loadReviews(cwd);
  return items.find(r => r.id === id) || null;
}

function timestampStamp(date = new Date()) {
  const iso = date.toISOString();
  return iso.replace(/[:T]/g, "-").replace(/\..+$/, "Z");
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "artifact";
}

function dumpReviewYaml(review) {
  const ordered = {};
  const keys = ["id", "target_kind", "target", "kind", "status", "text", "reviewer", "slice", "decision_ref", "follow_up", "created_at", "resolved_at", "resolved_by", "resolution_notes"];
  for (const k of keys) if (review[k] !== undefined) ordered[k] = review[k];
  return yaml.dump(ordered, { lineWidth: 100, noRefs: true });
}

function reviewerDefault() {
  return process.env.SHIPFLOW_REVIEWER
    || process.env.GIT_AUTHOR_NAME
    || process.env.USER
    || process.env.LOGNAME
    || "unknown";
}

export function createReview(cwd, payload) {
  const createdAt = payload.created_at || new Date().toISOString();
  const targetSlug = slugify(path.basename(String(payload.target || "target")));
  const id = payload.id || `${timestampStamp(new Date(createdAt))}-${targetSlug}`;
  const draft = {
    id,
    target_kind: payload.target_kind,
    target: payload.target,
    kind: payload.kind || "concern",
    status: payload.status || "open",
    text: payload.text,
    reviewer: payload.reviewer || reviewerDefault(),
    slice: payload.slice,
    decision_ref: payload.decision_ref,
    follow_up: payload.follow_up || [],
    created_at: createdAt,
  };
  for (const k of Object.keys(draft)) {
    if (draft[k] === undefined) delete draft[k];
  }
  const parsed = ArtifactReview.parse(draft);
  const dir = reviewsDir(cwd);
  mkdirp(dir);
  const file = path.join(dir, `${parsed.id}.yml`);
  if (fs.existsSync(file)) {
    throw new Error(`Review id collision: ${parsed.id}`);
  }
  writeFile(file, dumpReviewYaml(parsed));
  return { file, review: parsed };
}

export function resolveReview(cwd, id, { resolved_by, resolution_notes, status = "resolved" } = {}) {
  const review = findReview(cwd, id);
  if (!review) throw new Error(`Review not found: ${id}`);
  if (!REVIEW_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
  if (status === "open") throw new Error('To re-open, use shipflow review-artifact reopen');
  const next = { ...review };
  delete next.__file;
  next.status = status;
  next.resolved_at = new Date().toISOString();
  if (resolved_by) next.resolved_by = resolved_by;
  if (resolution_notes) next.resolution_notes = resolution_notes;
  const parsed = ArtifactReview.parse(next);
  writeFile(review.__file, dumpReviewYaml(parsed));
  return { file: review.__file, review: parsed };
}

export function reopenReview(cwd, id) {
  const review = findReview(cwd, id);
  if (!review) throw new Error(`Review not found: ${id}`);
  const next = { ...review };
  delete next.__file;
  next.status = "open";
  delete next.resolved_at;
  delete next.resolved_by;
  delete next.resolution_notes;
  const parsed = ArtifactReview.parse(next);
  writeFile(review.__file, dumpReviewYaml(parsed));
  return { file: review.__file, review: parsed };
}

export function listConcreteArtifacts(cwd) {
  const items = [];

  // VP files (durable, reviewable substrate)
  const vpDir = path.join(cwd, "vp");
  if (fs.existsSync(vpDir)) {
    for (const area of ["ui", "behavior", "api", "db", "domain", "nfr", "security", "technical"]) {
      const areaDir = path.join(vpDir, area);
      if (!fs.existsSync(areaDir)) continue;
      for (const file of fs.readdirSync(areaDir)) {
        if (file.endsWith(".yml") || file.endsWith(".yaml")) {
          items.push({
            kind: "vp",
            target: `vp/${area}/${file}`,
            label: `VP ${area}/ ${file}`,
          });
        }
      }
    }
    const policyDir = path.join(vpDir, "policy");
    if (fs.existsSync(policyDir)) {
      for (const file of fs.readdirSync(policyDir)) {
        if (file.endsWith(".rego")) {
          items.push({ kind: "vp", target: `vp/policy/${file}`, label: `Policy ${file}` });
        }
      }
    }
  }

  // Evidence files
  const evidenceDir = path.join(cwd, "evidence");
  if (fs.existsSync(evidenceDir)) {
    for (const file of fs.readdirSync(evidenceDir)) {
      const full = path.join(evidenceDir, file);
      const stat = fs.statSync(full);
      if (stat.isFile() && (file.endsWith(".json") || file.endsWith(".log") || file.endsWith(".txt"))) {
        items.push({
          kind: "evidence",
          target: `evidence/${file}`,
          label: `Evidence ${file}`,
        });
      }
    }
    // Look for screenshots / diffs
    const visualDir = path.join(evidenceDir, "visual");
    if (fs.existsSync(visualDir)) {
      for (const file of fs.readdirSync(visualDir)) {
        if (/\.(png|jpe?g|webp)$/i.test(file)) {
          items.push({
            kind: "screenshot",
            target: `evidence/visual/${file}`,
            label: `Screenshot ${file}`,
          });
        }
      }
    }
  }

  // Slices (review-able stories)
  const { items: slices } = loadSlices(cwd);
  for (const s of slices) {
    items.push({
      kind: "slice",
      target: s.id,
      label: `Slice ${s.id} — ${s.goal.slice(0, 60)}${s.goal.length > 60 ? "…" : ""}`,
      status: s.status,
    });
  }

  // Decisions
  const { items: decisions } = loadDecisions(cwd);
  for (const d of decisions) {
    items.push({
      kind: "decision",
      target: d.id,
      label: `Decision ${d.id} — ${d.title.slice(0, 60)}${d.title.length > 60 ? "…" : ""}`,
    });
  }

  return items;
}

function relPath(cwd, file) {
  return path.relative(cwd, file).replaceAll("\\", "/");
}

export function previewArtifacts({ cwd, json = false } = {}) {
  const artifacts = listConcreteArtifacts(cwd);
  const { items: reviews } = loadReviews(cwd);
  const openReviewsByTarget = new Map();
  for (const r of reviews.filter(r => r.status === "open")) {
    const list = openReviewsByTarget.get(r.target) || [];
    list.push(r);
    openReviewsByTarget.set(r.target, list);
  }

  if (json) {
    process.stdout.write(JSON.stringify({
      artifacts,
      open_reviews: reviews.filter(r => r.status === "open").map(r => ({ ...r, __file: relPath(cwd, r.__file) })),
    }, null, 2) + "\n");
    return { exitCode: 0 };
  }

  if (artifacts.length === 0) {
    console.log(dim("No concrete artifacts available to review yet."));
    console.log(dim("Add verifications, run shipflow verify, or create a slice to populate this surface."));
    return { exitCode: 0 };
  }

  const groups = new Map();
  for (const a of artifacts) {
    const list = groups.get(a.kind) || [];
    list.push(a);
    groups.set(a.kind, list);
  }

  console.log(bold("Concrete artifacts available for review"));
  console.log("");
  for (const kind of ["slice", "vp", "decision", "evidence", "screenshot"]) {
    const list = groups.get(kind);
    if (!list || list.length === 0) continue;
    console.log(bold(`  ${kind}/  (${list.length})`));
    for (const a of list) {
      const open = openReviewsByTarget.get(a.target) || [];
      const tag = open.length > 0 ? yellow(`  ⚑ ${open.length} open review${open.length > 1 ? "s" : ""}`) : "";
      console.log(`    ${a.target}${tag}`);
      console.log(dim(`      ${a.label}`));
    }
    console.log("");
  }

  const totalOpen = reviews.filter(r => r.status === "open").length;
  if (totalOpen > 0) {
    console.log(yellow(`Open reviews: ${totalOpen}`));
    console.log(dim('  Resolve with: shipflow review-artifact resolve <id> --resolution-notes="..."'));
  } else {
    console.log(green("No open artifact reviews."));
  }
  console.log(dim('Capture feedback with: shipflow review-artifact new --target=<vp/path|slice-id|...> --target-kind=<vp|slice|...> --text="..."'));
  return { exitCode: 0 };
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

export function reviewsCli({ cwd, args, json = false }) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "list") {
    const flags = parseFlags(rest);
    const { items, issues } = loadReviews(cwd);
    let filtered = items;
    if (flags.status) filtered = filtered.filter(r => r.status === flags.status);
    if (flags.target) filtered = filtered.filter(r => r.target === flags.target);
    if (flags.kind) filtered = filtered.filter(r => r.kind === flags.kind);
    if (json) {
      process.stdout.write(JSON.stringify({
        reviews: filtered.map(r => ({ ...r, __file: relPath(cwd, r.__file) })),
        issues: issues.map(i => ({ ...i, file: relPath(cwd, i.file) })),
      }, null, 2) + "\n");
      return { exitCode: issues.length ? 1 : 0 };
    }
    if (filtered.length === 0 && issues.length === 0) {
      console.log(dim("No artifact reviews on file."));
      return { exitCode: 0 };
    }
    console.log(bold(`Artifact reviews (${filtered.length})`));
    for (const r of filtered) {
      const tag = r.status === "open" ? yellow(r.status)
        : r.status === "resolved" ? green(r.status)
        : r.status === "wont_fix" ? red(r.status)
        : dim(r.status);
      console.log(`  ${bold(r.id)}  ${tag}  ${dim(`[${r.kind}]`)} ${r.target_kind}:${r.target}`);
      console.log(`    ${r.text}`);
      console.log(dim(`    by ${r.reviewer} @ ${r.created_at}`));
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
      console.error("usage: shipflow review-artifact show <id>");
      return { exitCode: 2 };
    }
    const r = findReview(cwd, id);
    if (!r) {
      console.error(`Review not found: ${id}`);
      return { exitCode: 1 };
    }
    if (json) {
      process.stdout.write(JSON.stringify({ ...r, __file: relPath(cwd, r.__file) }, null, 2) + "\n");
      return { exitCode: 0 };
    }
    console.log(JSON.stringify(r, null, 2));
    return { exitCode: 0 };
  }

  if (sub === "new") {
    const flags = parseFlags(rest);
    const required = ["target", "target-kind", "text"];
    const missing = required.filter(k => !flags[k]);
    if (missing.length) {
      console.error(`Missing required flags: ${missing.map(k => `--${k}`).join(", ")}`);
      console.error('usage: shipflow review-artifact new --target=<path-or-id> --target-kind=<vp|slice|evidence|screenshot|api_sample|decision|grill> --text="..." [--kind=concern|change_request|approval|question] [--reviewer=...] [--slice=...] [--decision-ref=...]');
      return { exitCode: 2 };
    }
    if (!REVIEW_TARGET_KINDS.includes(flags["target-kind"])) {
      console.error(`--target-kind must be one of: ${REVIEW_TARGET_KINDS.join(", ")}`);
      return { exitCode: 2 };
    }
    if (flags.kind && !REVIEW_KINDS.includes(flags.kind)) {
      console.error(`--kind must be one of: ${REVIEW_KINDS.join(", ")}`);
      return { exitCode: 2 };
    }
    try {
      const followUps = ensureArray(flags["follow-up"]).flatMap(v => String(v).split("\n")).map(s => s.trim()).filter(Boolean);
      const { review, file } = createReview(cwd, {
        target: flags.target,
        target_kind: flags["target-kind"],
        kind: flags.kind || "concern",
        text: flags.text,
        reviewer: flags.reviewer,
        slice: flags.slice,
        decision_ref: flags["decision-ref"],
        follow_up: followUps,
      });
      if (json) {
        process.stdout.write(JSON.stringify({ created: relPath(cwd, file), review }, null, 2) + "\n");
      } else {
        console.log(green(`Review captured: ${review.id}`));
        console.log(dim(`  ${relPath(cwd, file)}`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  if (sub === "resolve" || sub === "wont-fix") {
    const id = rest.find(a => !a.startsWith("--"));
    const flags = parseFlags(rest);
    if (!id) {
      console.error(`usage: shipflow review-artifact ${sub} <id> [--resolved-by=...] [--resolution-notes="..."]`);
      return { exitCode: 2 };
    }
    try {
      const status = sub === "resolve" ? "resolved" : "wont_fix";
      const { review } = resolveReview(cwd, id, {
        status,
        resolved_by: flags["resolved-by"],
        resolution_notes: flags["resolution-notes"],
      });
      if (json) {
        process.stdout.write(JSON.stringify({ review }, null, 2) + "\n");
      } else {
        console.log(green(`Review ${review.id} → ${review.status}`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  if (sub === "reopen") {
    const id = rest.find(a => !a.startsWith("--"));
    if (!id) {
      console.error("usage: shipflow review-artifact reopen <id>");
      return { exitCode: 2 };
    }
    try {
      const { review } = reopenReview(cwd, id);
      if (json) {
        process.stdout.write(JSON.stringify({ review }, null, 2) + "\n");
      } else {
        console.log(yellow(`Review ${review.id} re-opened`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  console.error(`Unknown review-artifact subcommand: ${sub}`);
  console.error("Available: list, show, new, resolve, wont-fix, reopen");
  return { exitCode: 2 };
}
