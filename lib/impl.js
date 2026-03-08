import fs from "node:fs";
import path from "node:path";
import { listFilesRec } from "./util/fs.js";
import { readConfig } from "./config.js";
import { readTechnicalChecks } from "./gen-technical.js";
import { generateWithProvider, normalizeProviderText, resolveProviderModel, resolveProviderName } from "./providers/index.js";

export { readConfig } from "./config.js";

const DEFAULT_IMPL_FILES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

const BLOCKED_IMPL_PREFIXES = ["vp", ".gen", "evidence"];
const BLOCKED_IMPL_FILES = ["shipflow.json", "playwright.config.ts"];

function collectFiles(dir, cwd) {
  if (!fs.existsSync(dir)) return [];
  return listFilesRec(dir)
    .filter(p => !p.includes("node_modules") && !p.includes(".DS_Store"))
    .map(p => ({
      path: path.relative(cwd, p).replaceAll("\\", "/"),
      content: fs.readFileSync(p, "utf-8"),
    }));
}

function normalizeProjectPath(relPath) {
  return String(relPath || "")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function isBlockedImplPath(relPath) {
  const normalized = normalizeProjectPath(relPath);
  if (!normalized) return false;
  if (BLOCKED_IMPL_FILES.includes(normalized)) return true;
  return BLOCKED_IMPL_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(prefix + "/"));
}

function addDerivedTarget(targets, relPath) {
  const normalized = normalizeProjectPath(relPath);
  if (!normalized || isBlockedImplPath(normalized)) return;
  targets.files.add(normalized);
  const parent = path.posix.dirname(normalized);
  if (parent && parent !== ".") targets.roots.add(parent);
}

function resolveConfigTarget(target) {
  const normalized = normalizeProjectPath(target);
  if (!normalized) return null;
  if (isBlockedImplPath(normalized)) return null;
  if (target.endsWith("/") || !path.posix.extname(normalized)) return { kind: "root", path: normalized };
  return { kind: "file", path: normalized };
}

export function resolveWritePolicy(cwd, config = {}) {
  const srcDir = normalizeProjectPath(config.impl?.srcDir || "src") || "src";
  const targets = {
    roots: new Set([srcDir]),
    files: new Set(DEFAULT_IMPL_FILES),
  };

  for (const target of Array.isArray(config.impl?.writeRoots) ? config.impl.writeRoots : []) {
    const resolved = resolveConfigTarget(String(target));
    if (!resolved) continue;
    if (resolved.kind === "root") targets.roots.add(resolved.path);
    else targets.files.add(resolved.path);
  }

  try {
    for (const check of readTechnicalChecks(path.join(cwd, "vp"))) {
      for (const assertion of check.assert) {
        if (assertion.path_exists) addDerivedTarget(targets, assertion.path_exists.path);
        else if (assertion.path_absent) addDerivedTarget(targets, assertion.path_absent.path);
        else if (assertion.file_contains) addDerivedTarget(targets, assertion.file_contains.path);
        else if (assertion.file_not_contains) addDerivedTarget(targets, assertion.file_not_contains.path);
        else if (assertion.json_has) addDerivedTarget(targets, assertion.json_has.path);
        else if (assertion.json_equals) addDerivedTarget(targets, assertion.json_equals.path);
        else if (assertion.dependency_present) addDerivedTarget(targets, assertion.dependency_present.path || "package.json");
        else if (assertion.dependency_absent) addDerivedTarget(targets, assertion.dependency_absent.path || "package.json");
        else if (assertion.github_action_uses) addDerivedTarget(targets, assertion.github_action_uses.workflow);
      }
    }
  } catch {
    // The normal loop already lint/gens before impl; keep impl resilient if technical checks are currently invalid.
  }

  return {
    roots: [...targets.roots].sort(),
    files: [...targets.files].sort(),
  };
}

export function isAllowedImplPath(relPath, writePolicy) {
  const normalized = normalizeProjectPath(relPath);
  if (!normalized) return false;
  if (isBlockedImplPath(normalized)) return false;
  if (writePolicy.files.includes(normalized)) return true;
  return writePolicy.roots.some(root => normalized === root || normalized.startsWith(root + "/"));
}

function collectEditableFiles(cwd, writePolicy) {
  const seen = new Map();

  for (const root of writePolicy.roots) {
    const fullRoot = path.join(cwd, root);
    if (!fs.existsSync(fullRoot)) continue;
    for (const file of collectFiles(fullRoot, cwd)) {
      seen.set(file.path, file);
    }
  }

  for (const relPath of writePolicy.files) {
    const full = path.join(cwd, relPath);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const normalized = path.relative(cwd, full).replaceAll("\\", "/");
    seen.set(normalized, {
      path: normalized,
      content: fs.readFileSync(full, "utf-8"),
    });
  }

  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function buildPrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy) {
  const srcDir = config.impl?.srcDir || "src";
  const lines = [];
  const allowedTargets = [
    ...writePolicy.roots.map(root => `${root}/**`),
    ...writePolicy.files,
  ];

  lines.push(`You are implementing an application from a ShipFlow verification pack.
The Verification Pack (YAML) defines the required behavior and constraints.
Generated tests and scripts define exactly how the project will be verified.

Rules:
- Only create or modify files inside these allowed write targets:
${allowedTargets.map(target => `  - ${target}`).join("\n")}
- Never modify blocked paths: vp/, .gen/, evidence/, shipflow.json, playwright.config.ts.
- Pay close attention to data-testid attributes, label text, aria roles, button text, and URL patterns in the tests.
- Respect API contracts, database assertions, security checks, technical constraints, and performance budgets described in the pack.
- Make the project fully functional so all generated verification checks pass.
- Return complete, working code — no placeholders or TODOs.`);

  if (config.impl?.context) {
    lines.push(`\n## Project Context\n${config.impl.context}`);
  }

  lines.push("\n## Verifications");
  for (const f of vpFiles) {
    lines.push(`\n### ${f.path}\n\`\`\`yaml\n${f.content}\`\`\``);
  }

  if (genFiles.length > 0) {
    lines.push("\n## Generated Playwright Tests (these will be executed)");
    for (const f of genFiles) {
      lines.push(`\n### ${f.path}\n\`\`\`typescript\n${f.content}\`\`\``);
    }
  }

  if (editableFiles.length > 0) {
    lines.push("\n## Current Editable Files");
    for (const f of editableFiles) {
      lines.push(`\n### ${f.path}\n\`\`\`\n${f.content}\`\`\``);
    }
  }

  if (errors) {
    const truncated = errors.length > 8000 ? errors.slice(-8000) : errors;
    lines.push(`\n## Test Failures — Fix These\n\`\`\`\n${truncated}\`\`\``);
  }

  lines.push(`\n## Output Format
Return ALL files needed using this exact format for each file:

--- FILE: path/to/file ---
file content here
--- END FILE ---

Only include files you want ShipFlow to write or overwrite.
Every returned path must stay inside the allowed write targets above.
Omitted files are preserved.`);

  return lines.join("\n");
}

export function parseFiles(text) {
  const normalized = normalizeProviderText(text, "files");
  const files = [];
  const regex = /--- FILE: (.+?) ---\n([\s\S]*?)--- END FILE ---/g;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    files.push({ path: match[1].trim(), content: match[2] });
  }
  return files;
}

export function resolveImplOptions(cwd, overrides = {}, deps = {}) {
  const config = readConfig(cwd);
  const configuredProvider = overrides.provider || process.env.SHIPFLOW_IMPL_PROVIDER || config.impl?.provider || "auto";
  const provider = resolveProviderName(configuredProvider, cwd, deps);
  const model = resolveProviderModel(config.impl, provider, {
    model: overrides.model,
    envModel: process.env.SHIPFLOW_IMPL_MODEL,
    legacyModel: typeof config.models?.impl === "string" ? config.models.impl : null,
  });
  const maxTokens = config.impl?.maxTokens || 16384;
  const srcDir = config.impl?.srcDir || "src";
  const writePolicy = resolveWritePolicy(cwd, config);
  const providerOptions = provider === "command"
    ? { command: config.impl?.command || null }
    : {};
  return { config, provider, model, maxTokens, srcDir, writePolicy, providerOptions, configuredProvider };
}

export async function impl({ cwd, errors, provider, model }) {
  const { config, provider: resolvedProvider, model: resolvedModel, maxTokens, writePolicy, providerOptions } = resolveImplOptions(cwd, { provider, model });

  const vpFiles = collectFiles(path.join(cwd, "vp"), cwd);
  const genFiles = collectFiles(path.join(cwd, ".gen"), cwd)
    .filter(f => f.path.endsWith(".test.ts") || f.path.endsWith(".test.js"));
  const editableFiles = collectEditableFiles(cwd, writePolicy);

  const prompt = buildPrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy);
  console.log(`ShipFlow impl: calling provider=${resolvedProvider}${resolvedModel ? ` model=${resolvedModel}` : ""}...`);
  const text = await generateWithProvider({
    provider: resolvedProvider,
    model: resolvedModel,
    maxTokens,
    prompt,
    cwd,
    options: providerOptions,
    responseFormat: "files",
  });

  const files = parseFiles(text);
  if (files.length === 0) {
    throw new Error("ShipFlow impl: AI returned no files.\n" + text.slice(0, 1000));
  }

  const allowed = files.filter(file => isAllowedImplPath(file.path, writePolicy));
  const rejected = files.filter(file => !isAllowedImplPath(file.path, writePolicy));
  if (rejected.length > 0) {
    console.warn(
      `ShipFlow impl: rejected ${rejected.length} file(s) outside the allowed write targets: ` +
      rejected.map(f => f.path).join(", ")
    );
  }

  for (const file of allowed) {
    const fullPath = path.join(cwd, file.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content, "utf-8");
  }

  console.log(`ShipFlow impl: wrote ${allowed.length} file(s) → ${allowed.map(f => f.path).join(", ")}`);
  return allowed.map(f => f.path);
}
