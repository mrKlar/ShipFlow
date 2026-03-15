import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listFilesRec } from "./util/fs.js";

export const SCAFFOLD_PLUGIN_MANIFEST = "shipflow-scaffold-plugin.json";
export const SCAFFOLD_PLUGIN_TYPES = new Set(["startup", "component"]);
export const SCAFFOLD_COMPONENT_KINDS = new Set([
  "api",
  "service",
  "database",
  "ui",
  "mobile",
  "tui",
  "worker",
  "integration",
  "other",
]);

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || "").trim()).filter(Boolean);
}

function pluginRootDir(cwd) {
  return path.join(cwd, ".shipflow", "scaffold-plugins");
}

function pluginInstallDir(cwd, id) {
  return path.join(pluginRootDir(cwd), id);
}

export function listScaffoldVerificationFiles(templateDir) {
  if (!fs.existsSync(templateDir)) return [];
  return listFilesRec(templateDir)
    .filter(file => fs.statSync(file).isFile())
    .map(file => path.relative(templateDir, file).replaceAll("\\", "/"))
    .filter(relative => /^vp\/.+\.ya?ml$/i.test(relative))
    .sort((a, b) => a.localeCompare(b));
}

function stateFilePath(cwd) {
  return path.join(cwd, ".shipflow", "scaffold-state.json");
}

function removeDir(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function defaultManifestErrors() {
  return {
    ok: false,
    issues: [],
  };
}

function validateManifest(manifest) {
  const result = defaultManifestErrors();
  if (!manifest || typeof manifest !== "object") {
    result.issues.push("Scaffold plugin manifest must be a JSON object.");
    return result;
  }

  const id = String(manifest.id || "").trim();
  const name = String(manifest.name || "").trim();
  const version = String(manifest.version || "").trim();
  const pluginType = String(manifest.plugin_type || "").trim();
  const description = String(manifest.description || "").trim();

  if (!id) result.issues.push("Manifest requires a non-empty id.");
  if (!name) result.issues.push("Manifest requires a non-empty name.");
  if (!version) result.issues.push("Manifest requires a non-empty version.");
  if (!description) result.issues.push("Manifest requires a non-empty description.");
  if (!SCAFFOLD_PLUGIN_TYPES.has(pluginType)) {
    result.issues.push(`Manifest plugin_type must be one of: ${[...SCAFFOLD_PLUGIN_TYPES].join(", ")}.`);
  }

  const llmSummary = String(manifest.llm?.summary || "").trim();
  const llmGuidance = normalizeStringArray(manifest.llm?.guidance);
  if (!llmSummary) result.issues.push("Manifest requires llm.summary so ShipFlow can brief the implementation agents.");
  if (llmGuidance.length === 0) result.issues.push("Manifest requires llm.guidance with at least one high-level instruction.");

  const componentKinds = normalizeStringArray(manifest.component_kinds);
  if (pluginType === "component") {
    if (componentKinds.length === 0) result.issues.push("Component plugins require component_kinds.");
    for (const kind of componentKinds) {
      if (!SCAFFOLD_COMPONENT_KINDS.has(kind)) {
        result.issues.push(`Unknown component kind "${kind}". Allowed kinds: ${[...SCAFFOLD_COMPONENT_KINDS].join(", ")}.`);
      }
    }
  }

  const installScript = manifest.install?.script;
  if (installScript !== undefined && typeof installScript !== "string") {
    result.issues.push("Manifest install.script must be a string when provided.");
  }
  const templateDir = manifest.apply?.template_dir;
  if (templateDir !== undefined && typeof templateDir !== "string") {
    result.issues.push("Manifest apply.template_dir must be a string when provided.");
  }

  result.ok = result.issues.length === 0;
  if (!result.ok) return result;

  return {
    ok: true,
    manifest: {
      schema_version: Number(manifest.schema_version || 1),
      id,
      name,
      version,
      plugin_type: pluginType,
      description,
      llm: {
        summary: llmSummary,
        guidance: llmGuidance,
      },
      capabilities: {
        app_shapes: normalizeStringArray(manifest.capabilities?.app_shapes),
        adds: normalizeStringArray(manifest.capabilities?.adds),
      },
      component_kinds: componentKinds,
      apply: {
        template_dir: String(templateDir || "template"),
        merge_package_json: manifest.apply?.merge_package_json !== false,
      },
      install: installScript ? { script: installScript } : null,
    },
  };
}

function extractZipArchive(zipPath, destination, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const result = spawn("unzip", ["-qq", zipPath, "-d", destination], {
    stdio: "pipe",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    const details = String(result.stderr || result.stdout || "").trim() || "unzip failed";
    throw new Error(details);
  }
}

function locateManifestFile(rootDir) {
  const matches = listFilesRec(rootDir).filter(file => path.basename(file) === SCAFFOLD_PLUGIN_MANIFEST);
  if (matches.length === 0) throw new Error(`Archive does not contain ${SCAFFOLD_PLUGIN_MANIFEST}.`);
  if (matches.length > 1) throw new Error(`Archive contains multiple ${SCAFFOLD_PLUGIN_MANIFEST} files.`);
  return matches[0];
}

function readManifestFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const validated = validateManifest(raw);
  if (!validated.ok) throw new Error(validated.issues.join(" "));
  return validated.manifest;
}

function pluginRecordFromInstallDir(installDir) {
  const manifestPath = path.join(installDir, SCAFFOLD_PLUGIN_MANIFEST);
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = readManifestFile(manifestPath);
  return {
    id: manifest.id,
    root_dir: installDir,
    manifest_path: manifestPath,
    manifest,
  };
}

export function installScaffoldPlugin(cwd, archivePath, deps = {}) {
  const resolvedArchive = path.resolve(cwd, archivePath);
  if (!fs.existsSync(resolvedArchive)) {
    return { ok: false, issues: [`Plugin archive not found: ${archivePath}`], actions: [], plugin: null };
  }
  if (path.extname(resolvedArchive).toLowerCase() !== ".zip") {
    return { ok: false, issues: ["Scaffold plugin archives must be .zip files."], actions: [], plugin: null };
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-scaffold-plugin-"));
  try {
    (deps.extractZip || extractZipArchive)(resolvedArchive, tempRoot, deps);
    const manifestFile = locateManifestFile(tempRoot);
    const manifest = readManifestFile(manifestFile);
    const packageRoot = path.dirname(manifestFile);
    const installDir = pluginInstallDir(cwd, manifest.id);

    if (manifest.install?.script) {
      const installScriptPath = path.join(packageRoot, manifest.install.script);
      if (!fs.existsSync(installScriptPath)) {
        return {
          ok: false,
          issues: [`Plugin install script is missing: ${manifest.install.script}`],
          actions: [],
          plugin: null,
        };
      }
    }

    const templateDir = path.join(packageRoot, manifest.apply.template_dir);
    if (!fs.existsSync(templateDir)) {
      return {
        ok: false,
        issues: [`Plugin template directory is missing: ${manifest.apply.template_dir}`],
        actions: [],
        plugin: null,
      };
    }
    if (manifest.plugin_type === "startup" && listScaffoldVerificationFiles(templateDir).length === 0) {
      return {
        ok: false,
        issues: ["Startup scaffold plugins must bundle base verification files under vp/ inside the template directory."],
        actions: [],
        plugin: null,
      };
    }

    removeDir(installDir);
    copyDir(packageRoot, installDir);
    const record = pluginRecordFromInstallDir(installDir);
    const actions = [
      `Installed scaffold plugin ${manifest.id}@${manifest.version}.`,
      `Plugin type: ${manifest.plugin_type}.`,
    ];
    return { ok: true, issues: [], actions, plugin: record };
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)],
      actions: [],
      plugin: null,
    };
  } finally {
    removeDir(tempRoot);
  }
}

export function listInstalledScaffoldPlugins(cwd) {
  const root = pluginRootDir(cwd);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => pluginRecordFromInstallDir(path.join(root, entry.name)))
    .filter(Boolean)
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export function loadInstalledScaffoldPlugin(cwd, id) {
  const dir = pluginInstallDir(cwd, id);
  if (!fs.existsSync(dir)) return null;
  return pluginRecordFromInstallDir(dir);
}

export function readScaffoldState(cwd) {
  const file = stateFilePath(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function writeScaffoldState(cwd, state) {
  const file = stateFilePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
  return file;
}

export function summarizePluginForLlm(manifest, source = {}) {
  return {
    kind: source.kind || "plugin",
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    plugin_type: manifest.plugin_type,
    description: manifest.description,
    llm: {
      summary: manifest.llm.summary,
      guidance: [...manifest.llm.guidance],
    },
    component_kinds: [...(manifest.component_kinds || [])],
    capabilities: {
      app_shapes: [...(manifest.capabilities?.app_shapes || [])],
      adds: [...(manifest.capabilities?.adds || [])],
    },
    base_verification_files: [...(source.base_verification_files || [])],
  };
}

export function updateScaffoldState(cwd, updates = {}) {
  const current = readScaffoldState(cwd) || {
    version: 1,
    startup: null,
    components: [],
  };
  const next = {
    version: 1,
    updated_at: new Date().toISOString(),
    startup: updates.startup !== undefined ? updates.startup : current.startup,
    components: Array.isArray(updates.components)
      ? updates.components
      : Array.isArray(current.components) ? current.components : [],
  };
  writeScaffoldState(cwd, next);
  return next;
}
