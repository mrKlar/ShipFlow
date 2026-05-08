// shipflow migrate — detect and apply layout changes for repos that
// were initialized against an older ShipFlow version. Idempotent and
// dry-run by default: nothing on disk changes unless the caller passes
// --apply (or apply: true to the programmatic API).
//
// Currently handled:
//   1. Slice files at slice/  -> move to .shipflow/slices/
//   2. .gitignore blanket-ignoring .shipflow/  -> replace with the
//      precise runtime-only list so durable substrate is committed.

import fs from "node:fs";
import path from "node:path";
import { mkdirp } from "./util/fs.js";
import { bold, dim, green, yellow } from "./util/color.js";
import { relPath } from "./util/cli.js";

const NEW_GITIGNORE_RUNTIME_LINES = [
  ".shipflow/runtime/",
  ".shipflow/draft-session.json",
  ".shipflow/implement-thread.json",
  ".shipflow/scaffold-state.json",
];

function listSliceFilesAtLegacyRoot(cwd) {
  const dir = path.join(cwd, "slice");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(f => path.join(dir, f));
}

function gitignoreState(cwd) {
  const file = path.join(cwd, ".gitignore");
  if (!fs.existsSync(file)) return { present: false };
  const text = fs.readFileSync(file, "utf-8");
  const lines = text.split(/\r?\n/);
  // A "blanket" ignore is the bare line `.shipflow/` (no leading bang,
  // no path suffix beyond the trailing slash). Anything more specific
  // (".shipflow/runtime/", "!.shipflow/decisions/", etc.) is fine.
  const blanketIdx = lines.findIndex(l => l.trim() === ".shipflow/");
  return { present: true, file, text, lines, blanketIdx };
}

export function detectMigrations(cwd) {
  const migrations = [];
  const legacyFiles = listSliceFilesAtLegacyRoot(cwd);
  if (legacyFiles.length > 0) {
    migrations.push({
      id: "slices.move-to-shipflow",
      description: `Move ${legacyFiles.length} slice file(s) from slice/ to .shipflow/slices/`,
      files: legacyFiles.map(f => relPath(cwd, f)),
    });
  }
  const gi = gitignoreState(cwd);
  if (gi.present && gi.blanketIdx !== -1) {
    migrations.push({
      id: "gitignore.precise-runtime",
      description: "Replace blanket .shipflow/ ignore with precise runtime-only entries",
      file: relPath(cwd, gi.file),
    });
  }
  return migrations;
}

function moveLegacySlices(cwd) {
  const legacy = listSliceFilesAtLegacyRoot(cwd);
  if (legacy.length === 0) return { moved: [] };
  const newDir = path.join(cwd, ".shipflow", "slices");
  mkdirp(newDir);
  const moved = [];
  for (const src of legacy) {
    const dest = path.join(newDir, path.basename(src));
    if (fs.existsSync(dest)) {
      throw new Error(`Cannot move ${relPath(cwd, src)} -> ${relPath(cwd, dest)}: destination already exists. Resolve manually.`);
    }
    fs.renameSync(src, dest);
    moved.push({ from: relPath(cwd, src), to: relPath(cwd, dest) });
  }
  // Try to remove the now-empty slice/ directory; fail silently if it
  // still has unrelated files.
  const oldDir = path.join(cwd, "slice");
  if (fs.existsSync(oldDir) && fs.readdirSync(oldDir).length === 0) {
    fs.rmdirSync(oldDir);
  }
  return { moved };
}

function rewriteGitignore(cwd) {
  const gi = gitignoreState(cwd);
  if (!gi.present || gi.blanketIdx === -1) return { changed: false };
  // Replace the single blanket line with the runtime-only list. Preserve
  // every other line in place — we don't reorder unrelated entries.
  const before = gi.lines.slice(0, gi.blanketIdx);
  const after = gi.lines.slice(gi.blanketIdx + 1);
  const next = [...before, ...NEW_GITIGNORE_RUNTIME_LINES, ...after].join("\n");
  fs.writeFileSync(gi.file, next);
  return { changed: true, file: relPath(cwd, gi.file) };
}

export function applyMigrations(cwd) {
  const migrations = detectMigrations(cwd);
  const applied = [];
  for (const m of migrations) {
    if (m.id === "slices.move-to-shipflow") {
      const result = moveLegacySlices(cwd);
      applied.push({ ...m, result });
    } else if (m.id === "gitignore.precise-runtime") {
      const result = rewriteGitignore(cwd);
      applied.push({ ...m, result });
    }
  }
  return { applied };
}

export function migrateCli({ cwd, args = [], json = false } = {}) {
  const flags = new Set(args.filter(a => a.startsWith("--")));
  const apply = flags.has("--apply");

  const migrations = detectMigrations(cwd);

  if (json) {
    if (apply) {
      const result = applyMigrations(cwd);
      process.stdout.write(JSON.stringify({
        mode: "apply",
        applied: result.applied,
      }, null, 2) + "\n");
      return { exitCode: 0 };
    }
    process.stdout.write(JSON.stringify({
      mode: "dry-run",
      pending: migrations,
    }, null, 2) + "\n");
    return { exitCode: 0 };
  }

  if (migrations.length === 0) {
    console.log(green("Repo is already on the current ShipFlow layout — no migrations needed."));
    return { exitCode: 0 };
  }

  console.log(bold(`Pending migrations (${migrations.length}):`));
  for (const m of migrations) {
    console.log(`  ${bold("[" + m.id + "]")} ${m.description}`);
    if (m.files) for (const f of m.files) console.log(dim(`    - ${f}`));
    if (m.file) console.log(dim(`    - ${m.file}`));
  }
  console.log("");
  if (apply) {
    const result = applyMigrations(cwd);
    console.log(green(`Applied ${result.applied.length} migration(s).`));
    for (const a of result.applied) {
      if (a.result?.moved) {
        for (const m of a.result.moved) console.log(dim(`  ${m.from} -> ${m.to}`));
      }
      if (a.result?.changed) console.log(dim(`  rewrote ${a.result.file}`));
    }
    return { exitCode: 0 };
  }
  console.log(yellow("Dry-run only. Re-run with --apply to perform the migration."));
  return { exitCode: 0 };
}
