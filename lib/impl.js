import fs from "node:fs";
import path from "node:path";
import { listFilesRec } from "./util/fs.js";
import { readConfig } from "./config.js";
import { loadManifest } from "./gen.js";
import { readTechnicalChecks } from "./gen-technical.js";
import { DEFAULT_PROVIDER_TIMEOUT_MS, generateWithProvider, normalizeProviderText, resolveProviderModel, resolveProviderName } from "./providers/index.js";

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
const BLOCKED_IMPL_FILES = ["shipflow.json"];

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

function generatedFenceLanguage(filePath) {
  const normalized = String(filePath || "").toLowerCase();
  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx")) return "typescript";
  if (normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs")) return "javascript";
  if (normalized.endsWith(".feature")) return "gherkin";
  if (normalized.endsWith(".json")) return "json";
  if (normalized.endsWith(".yml") || normalized.endsWith(".yaml")) return "yaml";
  return "";
}

function isTechnicalGeneratedArtifact(file) {
  return file?.output_kind === "technical"
    || String(file?.path || "").startsWith(".gen/technical/")
    || file?.label === "Technical";
}

function renderGeneratedArtifact(file) {
  const label = file.label ? `[${file.label}] ` : "";
  const detail = isTechnicalGeneratedArtifact(file)
    ? "repo-level technical runner omitted; use the verification YAML above as the source of truth"
    : "generated executable omitted; use the verification YAML above as the source of truth";
  return `  - ${label}${file.path} — ${detail}`;
}

function collectGeneratedArtifacts(cwd) {
  const manifest = loadManifest(cwd);
  if (manifest?.outputs && typeof manifest.outputs === "object") {
    const files = [];
    for (const [type, output] of Object.entries(manifest.outputs)) {
      for (const relPath of output.files || []) {
        const fullPath = path.join(cwd, relPath);
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
        files.push({
          path: relPath,
          content: fs.readFileSync(fullPath, "utf-8"),
          type,
          label: output.label || type,
          output_kind: output.output_kind || null,
        });
      }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  const genRoot = path.join(cwd, ".gen");
  if (!fs.existsSync(genRoot)) return [];
  return collectFiles(genRoot, cwd)
    .filter(file => file.path !== ".gen/manifest.json" && file.path !== ".gen/vp.lock.json")
    .map(file => ({
      ...file,
      type: null,
      label: "Generated",
      output_kind: null,
    }));
}

function providerReadsWorkspace(provider) {
  return ["claude", "codex", "gemini", "kiro"].includes(provider);
}

function buildRepoAwarePrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy) {
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
- Never modify blocked paths: vp/, .gen/, evidence/, shipflow.json.
- Read the verification pack and generated inventories from the workspace before you write code.
- Use vp/** as the source of truth for behavior and constraints.
- Use .gen/manifest.json and the generated artifact paths below to understand what will be executed.
- If vp/domain/** exists, treat it as business-verification source of truth for domain objects. Do a real data-engineering step: translate those business objects into technical persistence, read, write, and exchange models. Do not force a naive 1:1 mapping when references, read models, write models, or denormalized copies make the system better.
- Make the project fully functional so all generated verification checks pass.
- Fix real root causes. If a verification fails because the app, API, database, runtime, dependency, or environment is broken, repair that failure directly. Never fake a pass by hardcoding expected outputs, bypassing failing paths, suppressing errors, or stubbing around a broken backend or database.
- For browser UI work, reuse the design system or open-source design-system component library already present in the repo. If none exists and the user did not explicitly ask for a bespoke internal UI kit, use a standard, widely used open-source design-system component library appropriate to the stack instead of inventing one-off primitives. Only create a new local shared component library when the user explicitly asks for it or the repo already follows that pattern.
- Return complete, working code — no placeholders or TODOs.`);

  if (config.impl?.context) {
    lines.push(`\n## Project Context\n${config.impl.context}`);
  }

  lines.push("\n## Read These Verification Files First");
  if (vpFiles.length === 0) lines.push("  - vp/ (empty)");
  else {
    for (const f of vpFiles) lines.push(`  - ${f.path}`);
  }

  lines.push("\n## Generated Execution Inventory");
  lines.push("  - .gen/manifest.json");
  if (genFiles.length === 0) {
    lines.push("  - .gen/ (no generated artifacts found)");
  } else {
    for (const f of genFiles) {
      lines.push(renderGeneratedArtifact(f));
    }
  }

  lines.push("\n## Current Editable Files To Inspect");
  if (editableFiles.length === 0) lines.push(`  - ${srcDir}/ (currently empty)`);
  else for (const f of editableFiles) lines.push(`  - ${f.path}`);

  lines.push("\n## Implementation Flow");
  lines.push("1. Read the verification YAML under vp/**.");
  lines.push("2. Read .gen/manifest.json and any generated artifacts you need.");
  lines.push("3. Read the current editable files.");
  lines.push("4. Write only the files needed to make the verifications pass.");

  if (errors) {
    const truncated = errors.length > 8000 ? errors.slice(-8000) : errors;
    lines.push(`\n## Latest Verification Failures\n\`\`\`\n${truncated}\`\`\``);
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

function buildEmbeddedPrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy) {
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
- Never modify blocked paths: vp/, .gen/, evidence/, shipflow.json.
- Pay close attention to data-testid attributes, label text, aria roles, button text, and URL patterns in the tests.
- Respect API contracts, database assertions, security checks, technical constraints, and performance budgets described in the pack.
- If vp/domain/** exists, treat it as business-verification source of truth for domain objects. Do a real data-engineering step: translate those business objects into technical persistence, read, write, and exchange models. Do not force a naive 1:1 mapping when references, read models, write models, or denormalized copies make the system better.
- Make the project fully functional so all generated verification checks pass.
- Fix real root causes. If a verification fails because the app, API, database, runtime, dependency, or environment is broken, repair that failure directly. Never fake a pass by hardcoding expected outputs, bypassing failing paths, suppressing errors, or stubbing around a broken backend or database.
- For browser UI work, reuse the design system or open-source design-system component library already present in the repo. If none exists and the user did not explicitly ask for a bespoke internal UI kit, use a standard, widely used open-source design-system component library appropriate to the stack instead of inventing one-off primitives. Only create a new local shared component library when the user explicitly asks for it or the repo already follows that pattern.
- Return complete, working code — no placeholders or TODOs.`);

  if (config.impl?.context) {
    lines.push(`\n## Project Context\n${config.impl.context}`);
  }

  lines.push("\n## Verifications");
  for (const f of vpFiles) {
    lines.push(`\n### ${f.path}\n\`\`\`yaml\n${f.content}\`\`\``);
  }

  if (genFiles.length > 0) {
    lines.push("\n## Generated Verification Artifacts (inventory only)");
    lines.push("The generated runner code is intentionally omitted. Implement against the verification pack above and the failure output below.");
    for (const f of genFiles) {
      lines.push(renderGeneratedArtifact(f));
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

export function buildPrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy, options = {}) {
  if (providerReadsWorkspace(options.provider)) {
    return buildRepoAwarePrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy);
  }
  return buildEmbeddedPrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy);
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

export function buildFileFormatRepairPrompt(basePrompt, providerText) {
  const reply = String(providerText || "").trim();
  const excerpt = reply.length > 2000 ? reply.slice(0, 2000) + "\n...[truncated]" : reply;
  return [
    basePrompt,
    "",
    "## Format Correction",
    "Your previous reply did not include any valid ShipFlow file blocks.",
    "Return only file blocks using the exact markers below. Do not return a plan, summary, markdown fence, or commentary.",
    "",
    "--- FILE: path/to/file ---",
    "file content here",
    "--- END FILE ---",
    "",
    "Previous invalid reply:",
    "```text",
    excerpt,
    "```",
  ].join("\n");
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
  const timeoutMs = config.impl?.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS;
  const srcDir = config.impl?.srcDir || "src";
  const writePolicy = resolveWritePolicy(cwd, config);
  const providerOptions = provider === "command"
    ? { command: config.impl?.command || null }
    : {};
  return { config, provider, model, maxTokens, timeoutMs, srcDir, writePolicy, providerOptions, configuredProvider };
}

export async function impl({ cwd, errors, provider, model, deps = {} }) {
  const { config, provider: resolvedProvider, model: resolvedModel, maxTokens, timeoutMs, writePolicy, providerOptions } = resolveImplOptions(cwd, { provider, model });
  const generateWithProviderImpl = deps.generateWithProvider || generateWithProvider;

  const vpFiles = collectFiles(path.join(cwd, "vp"), cwd);
  const genFiles = collectGeneratedArtifacts(cwd);
  const editableFiles = collectEditableFiles(cwd, writePolicy);

  const prompt = buildPrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy, {
    provider: resolvedProvider,
  });
  console.log(`ShipFlow impl: calling provider=${resolvedProvider}${resolvedModel ? ` model=${resolvedModel}` : ""}...`);
  let text = "";
  let files = [];
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= 2; attempt++) {
    text = await generateWithProviderImpl({
      provider: resolvedProvider,
      model: resolvedModel,
      maxTokens,
      prompt: currentPrompt,
      cwd,
      options: providerOptions,
      responseFormat: "files",
      timeoutMs,
    });
    files = parseFiles(text);
    if (files.length > 0) break;
    if (attempt < 2) {
      console.warn("ShipFlow impl: provider returned no file blocks, retrying with stricter format instructions...");
      currentPrompt = buildFileFormatRepairPrompt(prompt, text);
    }
  }

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
