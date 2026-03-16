import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readConfig } from "./config.js";
import { listFilesRec } from "./util/fs.js";
import {
  installScaffoldPlugin,
  listScaffoldPackageBaseline,
  listScaffoldVerificationFiles,
  listInstalledScaffoldPlugins,
  loadInstalledScaffoldPlugin,
  readScaffoldState,
  summarizePluginForLlm,
  updateScaffoldState,
} from "./scaffold-plugins.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shipflowRoot = path.resolve(__dirname, "..");

export const PROJECT_SCAFFOLD_PRESETS = {
  "node-web-rest-sqlite": {
    id: "node-web-rest-sqlite",
    label: "Node web app with REST and SQLite",
    description: "Vanilla browser shell plus Node REST server scaffold with SQLite-ready structure.",
    llm: {
      summary: "A Node browser app foundation with a static UI shell, REST entrypoint, and SQLite-ready package scripts is already installed.",
      guidance: [
        "Extend the existing Node REST server instead of rebuilding the app shell from scratch.",
        "Keep the browser shell and package scripts intact while implementing the product behavior.",
      ],
    },
    capabilities: {
      app_shapes: ["fullstack-web-stateful"],
      adds: ["ui:web", "api:rest", "db:sqlite"],
    },
  },
  "node-web-graphql-sqlite": {
    id: "node-web-graphql-sqlite",
    label: "Node web app with GraphQL and SQLite",
    description: "Vanilla browser shell plus Node GraphQL server scaffold with SQLite-ready structure.",
    llm: {
      summary: "A Node browser app foundation with a static UI shell, GraphQL entrypoint, and SQLite-ready package scripts is already installed.",
      guidance: [
        "Extend the existing GraphQL server entrypoint instead of swapping to another GraphQL stack.",
        "Build the product logic on top of the installed browser shell and package scripts.",
      ],
    },
    capabilities: {
      app_shapes: ["fullstack-web-stateful"],
      adds: ["ui:web", "api:graphql", "db:sqlite"],
    },
  },
  "node-rest-service-sqlite": {
    id: "node-rest-service-sqlite",
    label: "Node REST service with SQLite",
    description: "Backend-only REST service scaffold with SQLite-ready structure.",
    llm: {
      summary: "A backend-only Node REST service foundation with package scripts and an HTTP entrypoint is already installed.",
      guidance: [
        "Extend the existing Node REST service instead of introducing an unrelated framework or UI shell.",
        "Keep the installed scripts and backend-only shape intact while implementing the service behavior.",
      ],
    },
    capabilities: {
      app_shapes: ["rest-service"],
      adds: ["api:rest", "service:node", "db:sqlite"],
    },
  },
  "vue-antdv-graphql-sqlite": {
    id: "vue-antdv-graphql-sqlite",
    label: "Vue + Ant Design Vue app with GraphQL and SQLite",
    description: "Vite-powered Vue 3 frontend plus Node GraphQL backend scaffold with Ant Design Vue.",
    llm: {
      summary: "A Vue 3 + Ant Design Vue + Vite frontend foundation and a Node GraphQL backend entrypoint are already installed.",
      guidance: [
        "Reuse the installed Ant Design Vue foundation and extend its components instead of replacing the design system.",
        "Keep the Vite client and Node GraphQL server split intact while implementing the app behavior.",
      ],
    },
    capabilities: {
      app_shapes: ["fullstack-web-stateful"],
      adds: ["ui:web", "ui:vue", "design-system:ant-design-vue", "api:graphql", "db:sqlite"],
    },
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
  ".gitkeep",
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

function resolveDescriptorTemplateDir(cwd, descriptor) {
  if (!descriptor?.id) return null;
  if (descriptor.kind === "preset" || descriptor.version === "builtin") {
    if (!PROJECT_SCAFFOLD_PRESETS[descriptor.id]) return null;
    return scaffoldTemplateDir(descriptor.id);
  }
  const pluginRecord = loadInstalledScaffoldPlugin(cwd, descriptor.id);
  if (!pluginRecord) return null;
  return path.join(pluginRecord.root_dir, pluginRecord.manifest.apply.template_dir);
}

export function listScaffoldTemplateFiles(cwd, descriptor) {
  const templateDir = resolveDescriptorTemplateDir(cwd, descriptor);
  if (!templateDir || !fs.existsSync(templateDir)) return [];
  return listTemplateFiles(templateDir).map(file => file.relative);
}

export function listInstalledScaffoldWritableFiles(cwd, scaffoldState = readScaffoldState(cwd)) {
  if (!scaffoldState) return [];
  const files = new Set();
  if (scaffoldState.startup) {
    for (const relPath of listScaffoldTemplateFiles(cwd, scaffoldState.startup)) files.add(relPath);
  }
  for (const component of Array.isArray(scaffoldState.components) ? scaffoldState.components : []) {
    for (const relPath of listScaffoldTemplateFiles(cwd, component)) files.add(relPath);
  }
  return [...files].sort((a, b) => a.localeCompare(b));
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

  if (!changed) return { changed: false, actions: [] };

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(next, null, 2) + "\n");
  return { changed: true, actions };
}

function hasImplementationFiles(dir) {
  const candidateRoots = ["src", "app", "client", "server", "web", "mobile", "tui"];
  const rootEntryPattern = /^(server|app|main|index)\.(?:[cm]?[jt]sx?|vue|svelte|html|css)$/i;

  for (const relRoot of candidateRoots) {
    const fullRoot = path.join(dir, relRoot);
    if (!fs.existsSync(fullRoot)) continue;
    if (!fs.statSync(fullRoot).isDirectory()) continue;
    for (const file of listFilesRec(fullRoot)) {
      const base = path.basename(file);
      if (SCAFFOLD_META_FILES.has(base)) continue;
      if (base.startsWith(".")) continue;
      return true;
    }
  }

  if (!fs.existsSync(dir)) return false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (SCAFFOLD_META_FILES.has(entry.name)) continue;
    if (rootEntryPattern.test(entry.name)) return true;
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
      kind: "preset",
      id: "vue-antdv-graphql-sqlite",
      reason: "Matched Vue + Ant Design Vue + GraphQL + SQLite context.",
      inferred: true,
    };
  }

  if (
    /\b(rest api|rest service|backend service|api service|api-only|api only)\b/.test(context)
    && /\bsqlite\b/.test(context)
    && !/\b(browser|web ui|frontend|page|screen|vue|react|next)\b/.test(context)
  ) {
    return {
      kind: "preset",
      id: "node-rest-service-sqlite",
      reason: "Matched backend-only REST service context.",
      inferred: true,
    };
  }

  if (
    /\bgraphql\b/.test(context)
    && /\bsqlite\b/.test(context)
    && /\b(browser|web app|web ui|frontend|page|screen|board|game|todo|movie)\b/.test(context)
  ) {
    return {
      kind: "preset",
      id: "node-web-graphql-sqlite",
      reason: "Matched browser-facing GraphQL + SQLite context.",
      inferred: true,
    };
  }

  if (
    /\b(rest api|\/api\/|api under|json api)\b/.test(context)
    && /\bsqlite\b/.test(context)
    && /\b(browser|web app|web ui|frontend|page|screen|todo)\b/.test(context)
  ) {
    return {
      kind: "preset",
      id: "node-web-rest-sqlite",
      reason: "Matched browser-facing REST + SQLite context.",
      inferred: true,
    };
  }

  return null;
}

function normalizeComponentEntries(entries) {
  if (!entries) return [];
  const raw = Array.isArray(entries) ? entries : [entries];
  const normalized = [];
  const seen = new Set();

  for (const item of raw) {
    const plugin = typeof item === "string"
      ? item.trim()
      : String(item?.plugin || "").trim();
    if (!plugin || seen.has(plugin)) continue;
    seen.add(plugin);
    normalized.push({
      plugin,
      force: item?.force === true,
    });
  }
  return normalized;
}

function resolveStartupChoice(cwd, scaffoldConfig = {}, overrides = {}) {
  const startupConfig = scaffoldConfig?.startup && typeof scaffoldConfig.startup === "object"
    ? scaffoldConfig.startup
    : scaffoldConfig;
  const explicitPreset = overrides.preset !== undefined
    ? String(overrides.preset || "").trim()
    : String(startupConfig?.preset || "").trim();
  const explicitPlugin = overrides.plugin !== undefined
    ? String(overrides.plugin || "").trim()
    : String(startupConfig?.plugin || "").trim();

  if (explicitPreset && explicitPlugin) {
    return {
      ok: false,
      reason: "impl.scaffold cannot select both a built-in preset and a plugin startup foundation.",
    };
  }

  if (explicitPreset) {
    if (!PROJECT_SCAFFOLD_PRESETS[explicitPreset]) {
      return {
        ok: false,
        reason: `Unknown scaffold preset "${explicitPreset}".`,
      };
    }
    return {
      ok: true,
      startup: {
        kind: "preset",
        id: explicitPreset,
        inferred: false,
        reason: "Explicit scaffold preset from shipflow.json.",
      },
    };
  }

  if (explicitPlugin) {
    return {
      ok: true,
      startup: {
        kind: "plugin",
        id: explicitPlugin,
        inferred: false,
        reason: "Explicit scaffold plugin from shipflow.json.",
      },
    };
  }

  const inferred = inferProjectScaffold({ impl: { context: scaffoldConfig?.context || readConfig(cwd).impl?.context || "" } });
  if (!inferred) return { ok: true, startup: null };
  if (hasImplementationFiles(cwd)) {
    return {
      ok: true,
      startup: null,
      skipReason: "implementation files already exist; auto scaffold skipped",
    };
  }
  return { ok: true, startup: inferred };
}

function presetDescriptor(presetId) {
  const preset = PROJECT_SCAFFOLD_PRESETS[presetId];
  if (!preset) return null;
  const templateDir = scaffoldTemplateDir(presetId);
  return {
    kind: "preset",
    id: preset.id,
    name: preset.label,
    version: "builtin",
    plugin_type: "startup",
    description: preset.description,
    llm: {
      summary: preset.llm.summary,
      guidance: [...preset.llm.guidance],
    },
    component_kinds: [],
    capabilities: {
      app_shapes: [...preset.capabilities.app_shapes],
      adds: [...preset.capabilities.adds],
    },
    base_verification_files: listScaffoldVerificationFiles(templateDir),
    base_package_names: listScaffoldPackageBaseline(templateDir),
  };
}

function applyTemplateDirectory(cwd, templateDir, force = false) {
  const actions = [];
  const createdFiles = [];
  let applied = false;

  for (const file of listTemplateFiles(templateDir)) {
    const destination = path.join(cwd, file.relative);
    const content = fs.readFileSync(file.source, "utf-8");

    if (file.relative === "package.json") {
      const merged = mergePackageJson(cwd, destination, content, force);
      if (merged.changed) {
        applied = true;
        actions.push(...merged.actions);
        createdFiles.push("package.json");
      }
      continue;
    }

    const existedBefore = fs.existsSync(destination);
    if (existedBefore && !force) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
    actions.push(`${existedBefore ? "Updated" : "Created"} ${file.relative}.`);
    createdFiles.push(file.relative);
    applied = true;
  }

  return {
    applied,
    actions,
    createdFiles: [...new Set(createdFiles)].sort(),
  };
}

function runPluginInstallScript(cwd, pluginRecord, deps = {}) {
  const script = pluginRecord.manifest.install?.script;
  if (!script) return { ok: true, actions: [], issues: [] };

  const spawn = deps.spawnSync || spawnSync;
  const scriptPath = path.join(pluginRecord.root_dir, script);
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, actions: [], issues: [`Plugin install script is missing: ${script}`] };
  }

  const result = spawn(process.execPath, [scriptPath], {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
    env: {
      ...process.env,
      SHIPFLOW_SCAFFOLD_PLUGIN_ID: pluginRecord.manifest.id,
      SHIPFLOW_SCAFFOLD_PLUGIN_TYPE: pluginRecord.manifest.plugin_type,
      SHIPFLOW_SCAFFOLD_PLUGIN_DIR: pluginRecord.root_dir,
      SHIPFLOW_SCAFFOLD_MANIFEST: pluginRecord.manifest_path,
      SHIPFLOW_SCAFFOLD_TARGET_DIR: cwd,
    },
  });

  if (result.status !== 0) {
    const details = String(result.stderr || result.stdout || "").trim() || "plugin install script failed";
    return { ok: false, actions: [], issues: [details] };
  }

  const actions = String(result.stdout || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `plugin:${pluginRecord.manifest.id}: ${line}`);

  return { ok: true, actions, issues: [] };
}

function applyPresetStartup(cwd, startup, force = false) {
  const templateDir = scaffoldTemplateDir(startup.id);
  if (!fs.existsSync(templateDir)) {
    return {
      ok: false,
      issues: [`Scaffold preset "${startup.id}" is missing its template directory.`],
      actions: [],
      created_files: [],
      applied: false,
      descriptor: null,
    };
  }
  if (listScaffoldVerificationFiles(templateDir).length === 0) {
    return {
      ok: false,
      issues: [`Startup scaffold "${startup.id}" must bundle base verification files under vp/.`],
      actions: [],
      created_files: [],
      applied: false,
      descriptor: null,
    };
  }
  if (hasImplementationFiles(cwd)) {
    return {
      ok: false,
      issues: [`Startup scaffold "${startup.id}" can only run on a greenfield repo.`],
      actions: [],
      created_files: [],
      applied: false,
      descriptor: null,
    };
  }
  const result = applyTemplateDirectory(cwd, templateDir, force);
  return {
    ok: true,
    issues: [],
    actions: startup.reason ? [startup.reason, ...result.actions] : result.actions,
    created_files: result.createdFiles,
    applied: result.applied,
    descriptor: presetDescriptor(startup.id),
  };
}

function applyComponentPlugin(cwd, entry, deps = {}) {
  const pluginRecord = loadInstalledScaffoldPlugin(cwd, entry.plugin);
  if (!pluginRecord) {
    return {
      ok: false,
      issues: [`Scaffold plugin "${entry.plugin}" is not installed in this repo.`],
      actions: [],
      created_files: [],
      applied: false,
      descriptor: null,
    };
  }
  if (pluginRecord.manifest.plugin_type !== "component") {
    return {
      ok: false,
      issues: [`Scaffold plugin "${entry.plugin}" is a startup plugin and cannot be used as a component add-on.`],
      actions: [],
      created_files: [],
      applied: false,
      descriptor: null,
    };
  }

  const templateDir = path.join(pluginRecord.root_dir, pluginRecord.manifest.apply.template_dir);
  const templateResult = applyTemplateDirectory(cwd, templateDir, entry.force === true);
  const installResult = runPluginInstallScript(cwd, pluginRecord, deps);
  if (!installResult.ok) {
    return {
      ok: false,
      issues: installResult.issues,
      actions: templateResult.actions,
      created_files: templateResult.createdFiles,
      applied: templateResult.applied,
      descriptor: null,
    };
  }

  return {
    ok: true,
    issues: [],
    actions: [
      `Applied component scaffold plugin ${pluginRecord.manifest.id}.`,
      ...templateResult.actions,
      ...installResult.actions,
    ],
    created_files: templateResult.createdFiles,
      applied: templateResult.applied || installResult.actions.length > 0,
    descriptor: summarizePluginForLlm(pluginRecord.manifest, {
      kind: "plugin",
      base_verification_files: listScaffoldVerificationFiles(templateDir),
      base_package_names: listScaffoldPackageBaseline(templateDir),
    }),
  };
}

function applyStartupPlugin(cwd, startup, force = false, deps = {}) {
  const pluginRecord = loadInstalledScaffoldPlugin(cwd, startup.id);
  if (!pluginRecord) {
    return {
      ok: false,
      issues: [`Scaffold plugin "${startup.id}" is not installed in this repo.`],
      actions: [],
      created_files: [],
      applied: false,
      descriptor: null,
    };
  }
  if (pluginRecord.manifest.plugin_type !== "startup") {
    return {
      ok: false,
      issues: [`Scaffold plugin "${startup.id}" is a component plugin and cannot be used as a startup foundation.`],
      actions: [],
      created_files: [],
      applied: false,
      descriptor: null,
    };
  }
  if (hasImplementationFiles(cwd)) {
    return {
      ok: false,
      issues: [`Startup scaffold plugin "${startup.id}" can only run on a greenfield repo.`],
      actions: [],
      created_files: [],
      applied: false,
      descriptor: null,
    };
  }

  const templateDir = path.join(pluginRecord.root_dir, pluginRecord.manifest.apply.template_dir);
  const verificationFiles = listScaffoldVerificationFiles(templateDir);
  if (verificationFiles.length === 0) {
    return {
      ok: false,
      issues: [`Startup scaffold plugin "${startup.id}" must bundle base verification files under vp/.`],
      actions: [],
      created_files: [],
      applied: false,
      descriptor: null,
    };
  }
  const templateResult = applyTemplateDirectory(cwd, templateDir, force);
  const installResult = runPluginInstallScript(cwd, pluginRecord, deps);
  if (!installResult.ok) {
    return {
      ok: false,
      issues: installResult.issues,
      actions: templateResult.actions,
      created_files: templateResult.createdFiles,
      applied: templateResult.applied,
      descriptor: null,
    };
  }

  return {
    ok: true,
    issues: [],
    actions: [
      startup.reason || `Applied startup scaffold plugin ${startup.id}.`,
      ...templateResult.actions,
      ...installResult.actions,
    ],
    created_files: templateResult.createdFiles,
    applied: templateResult.applied || installResult.actions.length > 0,
    descriptor: summarizePluginForLlm(pluginRecord.manifest, {
      kind: "plugin",
      base_verification_files: verificationFiles,
      base_package_names: listScaffoldPackageBaseline(templateDir),
    }),
  };
}

export function resolveProjectScaffold(cwd, { config = readConfig(cwd), preset, plugin, components } = {}) {
  const scaffoldConfig = config.impl?.scaffold;
  const hasManualOverride = preset !== undefined || plugin !== undefined || components !== undefined;
  if (!hasManualOverride && (scaffoldConfig === false || scaffoldConfig?.enabled === false)) {
    return { enabled: false, skipped: true, reason: "disabled in shipflow.json" };
  }

  const force = scaffoldConfig?.force === true;
  const startupChoice = resolveStartupChoice(cwd, {
    ...scaffoldConfig,
    context: config.impl?.context || "",
  }, { preset, plugin });
  if (!startupChoice.ok) {
    return { enabled: true, ok: false, reason: startupChoice.reason };
  }

  const componentEntries = components !== undefined
    ? normalizeComponentEntries(components)
    : normalizeComponentEntries(scaffoldConfig?.components);

  const actions = [];
  if (startupChoice.skipReason) actions.push(startupChoice.skipReason);
  if (!startupChoice.startup && componentEntries.length === 0) {
    return {
      enabled: true,
      skipped: true,
      reason: actions[0] || "no supported scaffold preset or plugin selected",
      components: [],
      startup: null,
    };
  }

  return {
    enabled: true,
    ok: true,
    force,
    startup: startupChoice.startup || null,
    components: componentEntries,
    actions,
    preset: startupChoice.startup?.kind === "preset" ? startupChoice.startup.id : null,
    plugin: startupChoice.startup?.kind === "plugin" ? startupChoice.startup.id : null,
    inferred: Boolean(startupChoice.startup?.inferred),
  };
}

export function applyProjectScaffold(cwd, { config = readConfig(cwd), force = false, preset, plugin, components, deps = {} } = {}) {
  const resolved = resolveProjectScaffold(cwd, { config, preset, plugin, components });
  if (resolved.ok === false) {
    return {
      ok: false,
      skipped: false,
      issues: [resolved.reason],
      actions: [],
      created_files: [],
      applied: false,
      preset: null,
      plugin: null,
      components: [],
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
      plugin: resolved.plugin || null,
      components: [],
      inferred: Boolean(resolved.inferred),
    };
  }

  const effectiveForce = force || resolved.force === true;
  const actions = [...(resolved.actions || [])];
  const createdFiles = [];
  let applied = false;
  let startupDescriptor = null;
  const componentDescriptors = [];
  const currentState = readScaffoldState(cwd) || { startup: null, components: [] };

  if (resolved.startup) {
    const startupAlreadyInstalled = !effectiveForce
      && currentState.startup
      && currentState.startup.id === resolved.startup.id
      && currentState.startup.kind === resolved.startup.kind;
    const startupResult = startupAlreadyInstalled
      ? {
        ok: true,
        applied: false,
        actions: [`Startup scaffold "${resolved.startup.id}" already installed.`],
        issues: [],
        created_files: [],
        descriptor: currentState.startup,
      }
      : resolved.startup.kind === "preset"
        ? applyPresetStartup(cwd, resolved.startup, effectiveForce)
        : applyStartupPlugin(cwd, resolved.startup, effectiveForce, deps);
    if (!startupResult.ok) {
      return {
        ok: false,
        skipped: false,
        issues: startupResult.issues,
        actions,
        created_files: createdFiles,
        applied,
        preset: resolved.preset || null,
        plugin: resolved.plugin || null,
        components: [],
      };
    }
    actions.push(...startupResult.actions);
    createdFiles.push(...startupResult.created_files);
    applied = applied || startupResult.applied;
    startupDescriptor = startupResult.descriptor;
  }

  for (const component of resolved.components || []) {
    const componentResult = applyComponentPlugin(cwd, component, deps);
    if (!componentResult.ok) {
      return {
        ok: false,
        skipped: false,
        issues: componentResult.issues,
        actions,
        created_files: [...new Set(createdFiles)].sort(),
        applied,
        preset: resolved.preset || null,
        plugin: resolved.plugin || null,
        components: componentDescriptors,
      };
    }
    actions.push(...componentResult.actions);
    createdFiles.push(...componentResult.created_files);
    applied = applied || componentResult.applied;
    if (componentResult.descriptor) componentDescriptors.push(componentResult.descriptor);
  }

  if (applied) {
    const mergedComponents = [...(Array.isArray(currentState.components) ? currentState.components : [])];
    for (const descriptor of componentDescriptors) {
      const index = mergedComponents.findIndex(item => item.id === descriptor.id);
      if (index >= 0) mergedComponents[index] = descriptor;
      else mergedComponents.push(descriptor);
    }
    const nextState = updateScaffoldState(cwd, {
      startup: startupDescriptor !== null ? startupDescriptor : currentState.startup,
      components: mergedComponents,
    });
    if (nextState?.updated_at) {
      actions.push(`Updated .shipflow/scaffold-state.json.`);
    }
  }

  return {
    ok: true,
    skipped: false,
    issues: [],
    actions,
    created_files: [...new Set(createdFiles)].sort(),
    applied,
    preset: resolved.preset || null,
    plugin: resolved.plugin || null,
    components: componentDescriptors,
    inferred: Boolean(resolved.inferred),
  };
}

export function scaffold({ cwd, force = false, preset, plugin, components } = {}) {
  const result = applyProjectScaffold(cwd, { force, preset, plugin, components });
  if (!result.ok) {
    for (const issue of result.issues || []) console.error(`- ${issue}`);
    return { exitCode: 1, result };
  }
  if (result.skipped) {
    for (const action of result.actions || []) console.log(`- ${action}`);
    return { exitCode: 0, result };
  }
  const startupLabel = result.plugin || result.preset;
  if (startupLabel) console.log(`Applied scaffold foundation: ${startupLabel}`);
  for (const component of result.components || []) {
    console.log(`Applied scaffold component: ${component.id}`);
  }
  for (const action of result.actions || []) console.log(`- ${action}`);
  return { exitCode: 0, result };
}

export function scaffoldPlugin({ cwd, input = "", deps = {} }) {
  const [subcommand = "", ...rest] = String(input || "").trim().split(/\s+/).filter(Boolean);
  if (subcommand === "install") {
    const archivePath = rest.join(" ").trim();
    if (!archivePath) {
      console.error("Usage: shipflow scaffold-plugin install <plugin.zip>");
      return { exitCode: 2 };
    }
    const result = installScaffoldPlugin(cwd, archivePath, deps);
    if (!result.ok) {
      for (const issue of result.issues || []) console.error(`- ${issue}`);
      return { exitCode: 1, result };
    }
    for (const action of result.actions || []) console.log(`- ${action}`);
    return { exitCode: 0, result };
  }

  if (subcommand === "list") {
    const plugins = listInstalledScaffoldPlugins(cwd);
    if (plugins.length === 0) {
      console.log("No scaffold plugins installed in this repo.");
      return { exitCode: 0 };
    }
    for (const pluginRecord of plugins) {
      const manifest = pluginRecord.manifest;
      const suffix = manifest.plugin_type === "component"
        ? ` [${manifest.component_kinds.join(", ")}]`
        : "";
      console.log(`${manifest.id}@${manifest.version} (${manifest.plugin_type})${suffix}`);
      console.log(`- ${manifest.description}`);
    }
    return { exitCode: 0 };
  }

  console.error("Usage:");
  console.error("  shipflow scaffold-plugin install <plugin.zip>");
  console.error("  shipflow scaffold-plugin list");
  return { exitCode: 2 };
}
