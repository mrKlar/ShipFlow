import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";
import { listFilesRec } from "./util/fs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shipflowRoot = path.resolve(__dirname, "..");

export const PROJECT_SCAFFOLD_PRESETS = {
  "node-web-rest-sqlite": {
    id: "node-web-rest-sqlite",
    label: "Node web app with REST and SQLite",
    description: "Vanilla browser shell plus Node REST server scaffold with SQLite-ready structure.",
  },
  "node-web-graphql-sqlite": {
    id: "node-web-graphql-sqlite",
    label: "Node web app with GraphQL and SQLite",
    description: "Vanilla browser shell plus Node GraphQL server scaffold with SQLite-ready structure.",
  },
  "node-rest-service-sqlite": {
    id: "node-rest-service-sqlite",
    label: "Node REST service with SQLite",
    description: "Backend-only REST service scaffold with SQLite-ready structure.",
  },
  "vue-antdv-graphql-sqlite": {
    id: "vue-antdv-graphql-sqlite",
    label: "Vue + Ant Design Vue app with GraphQL and SQLite",
    description: "Vite-powered Vue 3 frontend plus Node GraphQL backend scaffold with Ant Design Vue.",
  },
};

const SCAFFOLD_IGNORED = new Set([
  ".git",
  ".gen",
  ".shipflow",
  ".codex",
  ".claude",
  ".gemini",
  ".kiro",
  "node_modules",
  "evidence",
  "vp",
  "dist",
  "coverage",
]);

const SCAFFOLD_META_FILES = new Set([
  "shipflow.json",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ".gitignore",
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  "KIRO.md",
  "request.txt",
  "README.md",
]);

function sanitizePackageName(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "shipflow-app";
}

function normalizeContext(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase();
}

function scaffoldTemplateDir(preset) {
  return path.join(shipflowRoot, "templates", "scaffolds", preset);
}

function listTemplateFiles(templateDir) {
  if (!fs.existsSync(templateDir)) return [];
  return listFilesRec(templateDir)
    .filter(file => fs.statSync(file).isFile())
    .map(file => ({
      source: file,
      relative: path.relative(templateDir, file).replaceAll("\\", "/"),
    }))
    .sort((a, b) => a.relative.localeCompare(b.relative));
}

function mergeArray(target, additions) {
  const next = Array.isArray(target) ? [...target] : [];
  for (const item of additions || []) {
    if (!next.includes(item)) next.push(item);
  }
  return next;
}

function mergeObject(target, source, options = {}) {
  const force = options.force === true;
  const actions = [];
  let changed = false;
  const next = target && typeof target === "object" ? { ...target } : {};

  for (const [key, value] of Object.entries(source || {})) {
    if (!(key in next) || next[key] === undefined || next[key] === null || next[key] === "") {
      next[key] = value;
      actions.push(`${options.label || "object"}: set ${key}`);
      changed = true;
      continue;
    }
    if (!force) continue;
    if (JSON.stringify(next[key]) === JSON.stringify(value)) continue;
    next[key] = value;
    actions.push(`${options.label || "object"}: updated ${key}`);
    changed = true;
  }

  return { value: next, changed, actions };
}

function mergePackageJson(cwd, destination, templateContent, force = false) {
  const template = JSON.parse(templateContent);
  let current = {};
  if (fs.existsSync(destination)) {
    current = JSON.parse(fs.readFileSync(destination, "utf-8"));
  }

  const actions = [];
  let changed = false;
  const next = { ...current };

  if (!next.name) {
    next.name = sanitizePackageName(path.basename(cwd));
    actions.push("package.json: set name");
    changed = true;
  }

  for (const key of ["private", "type", "packageManager"]) {
    if (template[key] === undefined) continue;
    if (!(key in next) || next[key] === undefined || next[key] === null || next[key] === "") {
      next[key] = template[key];
      actions.push(`package.json: set ${key}`);
      changed = true;
    } else if (force && JSON.stringify(next[key]) !== JSON.stringify(template[key])) {
      next[key] = template[key];
      actions.push(`package.json: updated ${key}`);
      changed = true;
    }
  }

  for (const key of ["scripts", "dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (!template[key]) continue;
    const merged = mergeObject(next[key], template[key], { force, label: `package.json.${key}` });
    if (merged.changed) {
      next[key] = merged.value;
      actions.push(...merged.actions);
      changed = true;
    } else if (!next[key] && template[key]) {
      next[key] = { ...template[key] };
      changed = true;
    }
  }

  if (Array.isArray(template.keywords)) {
    const mergedKeywords = mergeArray(next.keywords, template.keywords);
    if (JSON.stringify(mergedKeywords) !== JSON.stringify(next.keywords || [])) {
      next.keywords = mergedKeywords;
      actions.push("package.json: merged keywords");
      changed = true;
    }
  }

  if (!changed) {
    return { changed: false, actions: [] };
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(next, null, 2) + "\n");
  return { changed: true, actions };
}

function hasImplementationFiles(dir) {
  if (!fs.existsSync(dir)) return false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SCAFFOLD_IGNORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasImplementationFiles(full)) return true;
      continue;
    }
    if (!SCAFFOLD_META_FILES.has(entry.name)) return true;
  }
  return false;
}

function inferProjectScaffold(config = {}) {
  const context = normalizeContext(config.impl?.context || "");
  if (!context) return null;

  if (
    /\bvue(?:\.js| 3|3)?\b/.test(context)
    && /\bant[ -]?design(?: vue)?\b|\bantdv\b/.test(context)
    && /\bgraphql\b/.test(context)
    && /\bsqlite\b/.test(context)
  ) {
    return {
      preset: "vue-antdv-graphql-sqlite",
      reason: "Matched Vue + Ant Design Vue + GraphQL + SQLite context.",
    };
  }

  if (
    /\b(rest api|rest service|backend service|api service|api-only|api only)\b/.test(context)
    && /\bsqlite\b/.test(context)
    && !/\b(browser|web ui|frontend|page|screen|vue|react|next)\b/.test(context)
  ) {
    return {
      preset: "node-rest-service-sqlite",
      reason: "Matched backend-only REST service context.",
    };
  }

  if (
    /\bgraphql\b/.test(context)
    && /\bsqlite\b/.test(context)
    && /\b(browser|web app|web ui|frontend|page|screen|board|game|todo|movie)\b/.test(context)
  ) {
    return {
      preset: "node-web-graphql-sqlite",
      reason: "Matched browser-facing GraphQL + SQLite context.",
    };
  }

  if (
    /\b(rest api|\/api\/|api under|json api)\b/.test(context)
    && /\bsqlite\b/.test(context)
    && /\b(browser|web app|web ui|frontend|page|screen|todo)\b/.test(context)
  ) {
    return {
      preset: "node-web-rest-sqlite",
      reason: "Matched browser-facing REST + SQLite context.",
    };
  }

  return null;
}

export function resolveProjectScaffold(cwd, { config = readConfig(cwd) } = {}) {
  const scaffoldConfig = config.impl?.scaffold;
  if (scaffoldConfig === false || scaffoldConfig?.enabled === false) {
    return { enabled: false, skipped: true, reason: "disabled in shipflow.json" };
  }

  const explicitPreset = typeof scaffoldConfig === "string"
    ? scaffoldConfig.trim()
    : String(scaffoldConfig?.preset || "").trim();
  const force = scaffoldConfig?.force === true;

  if (explicitPreset) {
    if (!PROJECT_SCAFFOLD_PRESETS[explicitPreset]) {
      return {
        enabled: true,
        ok: false,
        reason: `Unknown scaffold preset "${explicitPreset}".`,
      };
    }
    return {
      enabled: true,
      ok: true,
      preset: explicitPreset,
      inferred: false,
      force,
      reason: "Explicit scaffold preset from shipflow.json.",
    };
  }

  const inferred = inferProjectScaffold(config);
  if (!inferred) {
    return { enabled: true, skipped: true, reason: "no supported scaffold preset inferred" };
  }
  if (hasImplementationFiles(cwd)) {
    return {
      enabled: true,
      skipped: true,
      reason: "implementation files already exist; auto scaffold skipped",
      inferred: true,
      preset: inferred.preset,
    };
  }

  return {
    enabled: true,
    ok: true,
    preset: inferred.preset,
    inferred: true,
    force,
    reason: inferred.reason,
  };
}

export function applyProjectScaffold(cwd, { config = readConfig(cwd), force = false } = {}) {
  const resolved = resolveProjectScaffold(cwd, { config });
  if (resolved.ok === false) {
    return {
      ok: false,
      skipped: false,
      issues: [resolved.reason],
      actions: [],
      created_files: [],
      applied: false,
      preset: null,
    };
  }
  if (resolved.skipped) {
    return {
      ok: true,
      skipped: true,
      issues: [],
      actions: resolved.reason ? [resolved.reason] : [],
      created_files: [],
      applied: false,
      preset: resolved.preset || null,
      inferred: Boolean(resolved.inferred),
    };
  }

  const preset = resolved.preset;
  const templateDir = scaffoldTemplateDir(preset);
  if (!fs.existsSync(templateDir)) {
    return {
      ok: false,
      skipped: false,
      issues: [`Scaffold preset "${preset}" is missing its template directory.`],
      actions: [],
      created_files: [],
      applied: false,
      preset,
      inferred: Boolean(resolved.inferred),
    };
  }

  const effectiveForce = force || resolved.force === true;
  const actions = [];
  const createdFiles = [];
  let applied = false;

  for (const file of listTemplateFiles(templateDir)) {
    const destination = path.join(cwd, file.relative);
    const content = fs.readFileSync(file.source, "utf-8");

    if (file.relative === "package.json") {
      const merged = mergePackageJson(cwd, destination, content, effectiveForce);
      if (merged.changed) {
        applied = true;
        actions.push(...merged.actions);
        createdFiles.push("package.json");
      }
      continue;
    }

    const existedBefore = fs.existsSync(destination);
    if (existedBefore && !effectiveForce) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
    actions.push(`${existedBefore ? "Updated" : "Created"} ${file.relative}.`);
    createdFiles.push(file.relative);
    applied = true;
  }

  if (resolved.reason) actions.unshift(resolved.reason);

  return {
    ok: true,
    skipped: false,
    issues: [],
    actions,
    created_files: [...new Set(createdFiles)].sort(),
    applied,
    preset,
    inferred: Boolean(resolved.inferred),
  };
}

export function scaffold({ cwd, force = false }) {
  const result = applyProjectScaffold(cwd, { force });
  if (!result.ok) {
    for (const issue of result.issues || []) console.error(`- ${issue}`);
    return { exitCode: 1, result };
  }
  if (result.skipped) {
    for (const action of result.actions || []) console.log(`- ${action}`);
    return { exitCode: 0, result };
  }
  console.log(`Applied scaffold preset: ${result.preset}`);
  for (const action of result.actions || []) console.log(`- ${action}`);
  return { exitCode: 0, result };
}
