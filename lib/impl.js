import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listFilesRec } from "./util/fs.js";
import { readConfig } from "./config.js";
import { loadManifest } from "./gen.js";
import { readTechnicalChecks } from "./gen-technical.js";
import { createImplementationLogger } from "./implementation-logs.js";
import { listInstalledScaffoldWritableFiles } from "./scaffold.js";
import { readScaffoldState } from "./scaffold-plugins.js";
import {
  IMPLEMENTATION_SPECIALIST_ROLES,
  buildImplementationMemo,
  fallbackStrategyDecision,
  normalizeImplementationTeam,
  readImplementationThread,
} from "./implementation-team.js";
import { DEFAULT_PROVIDER_TIMEOUT_MS, generateWithProvider, normalizeProviderText, resolveProviderModel, resolveProviderName } from "./providers/index.js";

export { readConfig } from "./config.js";

const DEFAULT_IMPL_FILES = [
  "package.json",
];

const BLOCKED_IMPL_PREFIXES = ["vp", ".gen", "evidence", ".shipflow"];
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
  const scaffoldState = readScaffoldState(cwd);

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

  for (const relPath of listInstalledScaffoldWritableFiles(cwd, scaffoldState)) {
    addDerivedTarget(targets, relPath);
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

function verificationTypesFromVpFiles(vpFiles = []) {
  return [...new Set(
    vpFiles
      .map(file => String(file.path || "").split("/")[1] || "")
      .map(type => {
        if (type === "db") return "db";
        return type;
      })
      .filter(Boolean),
  )];
}

function summarizeRepoAwareFailures(errors, maxChars = 2400) {
  const text = String(errors || "").trim();
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const keep = [];
  let followup = 0;
  const interesting = /(^Summary:)|(^\s*(?:✗|FAIL|Error:))|(\bAssertionError\b)|(\bfailed\b)|(\btimed out\b)|(\bExpected\b)/i;
  for (const line of lines) {
    if (interesting.test(line)) {
      keep.push(line.slice(0, 300));
      followup = 3;
      continue;
    }
    if (followup > 0 && line.trim()) {
      keep.push(line.slice(0, 300));
      followup -= 1;
    }
  }
  const summary = [...new Set(keep)].join("\n").trim();
  const compact = summary || text.slice(-maxChars);
  return compact.length > maxChars ? compact.slice(0, maxChars) : compact;
}

function appendScaffoldContext(lines, scaffoldState) {
  if (!scaffoldState) return;
  const hasStartup = Boolean(scaffoldState.startup);
  const components = Array.isArray(scaffoldState.components) ? scaffoldState.components : [];
  if (!hasStartup && components.length === 0) return;

  lines.push("\n## Deterministic Foundation Already Installed");
  lines.push("Do not rebuild this foundation from scratch. Extend it.");

  if (hasStartup) {
    lines.push(`- Startup foundation: ${scaffoldState.startup.id}`);
    if (scaffoldState.startup.description) lines.push(`  description: ${scaffoldState.startup.description}`);
    if (scaffoldState.startup.llm?.summary) lines.push(`  summary: ${scaffoldState.startup.llm.summary}`);
    if (scaffoldState.startup.base_verification_files?.length > 0) {
      lines.push(`  base verification files: ${scaffoldState.startup.base_verification_files.join(", ")}`);
    }
    for (const item of scaffoldState.startup.llm?.guidance || []) lines.push(`  guidance: ${item}`);
  }

  for (const component of components) {
    lines.push(`- Component scaffold: ${component.id}`);
    if (component.component_kinds?.length > 0) lines.push(`  kinds: ${component.component_kinds.join(", ")}`);
    if (component.description) lines.push(`  description: ${component.description}`);
    if (component.llm?.summary) lines.push(`  summary: ${component.llm.summary}`);
    if (component.base_verification_files?.length > 0) {
      lines.push(`  added verification files: ${component.base_verification_files.join(", ")}`);
    }
    for (const item of component.llm?.guidance || []) lines.push(`  guidance: ${item}`);
  }
}

function buildRepoAwarePrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy, evidenceFiles = []) {
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
- Never modify blocked paths: vp/, .gen/, evidence/, .shipflow/, shipflow.json.
- Do not hand-edit lockfiles. ShipFlow syncs dependencies after each implementation pass and will regenerate lockfiles itself.
- Read the verification pack and generated inventories from the workspace before you write code.
- Read .shipflow/implement-thread.json if it exists to understand what was already tried and what stalled.
- Use vp/** as the source of truth for behavior and constraints.
- Use .gen/manifest.json and the generated artifact paths below to understand what will be executed.
- If vp/domain/** exists, treat it as business-verification source of truth for domain objects. Do a real data-engineering step: translate those business objects into technical persistence, read, write, and exchange models. Do not force a naive 1:1 mapping when references, read models, write models, or denormalized copies make the system better.
- Domain translation must produce transport-safe technical objects. Normalize driver-native values such as BigInt row ids, numeric strings, binary payloads, or DB timestamps before returning them through JSON, REST, GraphQL, UI state, or events.
- Make the project fully functional so all generated verification checks pass.
- Fix real root causes. If a verification fails because the app, API, database, runtime, dependency, or environment is broken, repair that failure directly. Never fake a pass by hardcoding expected outputs, bypassing failing paths, suppressing errors, or stubbing around a broken backend or database.
- Do not change ShipFlow verification runtime packages or package-manager override mechanisms unless the verification pack explicitly requires it. In particular, do not add conflicting package.json overrides/resolutions for @playwright/test, playwright, playwright-core, @cucumber/cucumber, pixelmatch, or pngjs.
- For browser UI work, reuse the design system or open-source design-system component library already present in the repo. If none exists and the user did not explicitly ask for a bespoke internal UI kit, use a standard, widely used open-source design-system component library appropriate to the stack instead of inventing one-off primitives. Only create a new local shared component library when the user explicitly asks for it or the repo already follows that pattern.
- Return complete, working code — no placeholders or TODOs.`);

  if (config.impl?.context) {
    lines.push(`\n## Project Context\n${config.impl.context}`);
  }
  appendScaffoldContext(lines, writePolicy.scaffoldState);

  lines.push("\n## Read These Verification Files First");
  lines.push("  - .shipflow/implement-thread.json (if present)");
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
  lines.push("2. Read .shipflow/implement-thread.json if it exists.");
  lines.push("3. Read .gen/manifest.json and any generated artifacts you need.");
  lines.push("4. Read the current editable files.");
  if (errors && evidenceFiles.length > 0) lines.push("5. Read the latest evidence/*.json and evidence/artifacts/*.log for the failing checks before you edit code.");
  lines.push(`${errors && evidenceFiles.length > 0 ? "6" : "5"}. Write only the files needed to make the verifications pass.`);

  if (errors) {
    const summary = summarizeRepoAwareFailures(errors);
    lines.push(`\n## Latest Verification Failures\n\`\`\`\n${summary}\n\`\`\``);
  }

  if (errors && evidenceFiles.length > 0) {
    lines.push("\n## Failure Evidence To Inspect");
    for (const file of evidenceFiles) lines.push(`  - ${file}`);
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
- Never modify blocked paths: vp/, .gen/, evidence/, .shipflow/, shipflow.json.
- Do not hand-edit lockfiles. ShipFlow syncs dependencies after each implementation pass and will regenerate lockfiles itself.
- Pay close attention to data-testid attributes, label text, aria roles, button text, and URL patterns in the tests.
- Use .shipflow/implement-thread.json as the compact continuity thread if it is present.
- Respect API contracts, database assertions, security checks, technical constraints, and performance budgets described in the pack.
- If vp/domain/** exists, treat it as business-verification source of truth for domain objects. Do a real data-engineering step: translate those business objects into technical persistence, read, write, and exchange models. Do not force a naive 1:1 mapping when references, read models, write models, or denormalized copies make the system better.
- Domain translation must produce transport-safe technical objects. Normalize driver-native values such as BigInt row ids, numeric strings, binary payloads, or DB timestamps before returning them through JSON, REST, GraphQL, UI state, or events.
- Make the project fully functional so all generated verification checks pass.
- Fix real root causes. If a verification fails because the app, API, database, runtime, dependency, or environment is broken, repair that failure directly. Never fake a pass by hardcoding expected outputs, bypassing failing paths, suppressing errors, or stubbing around a broken backend or database.
- Do not change ShipFlow verification runtime packages or package-manager override mechanisms unless the verification pack explicitly requires it. In particular, do not add conflicting package.json overrides/resolutions for @playwright/test, playwright, playwright-core, @cucumber/cucumber, pixelmatch, or pngjs.
- For browser UI work, reuse the design system or open-source design-system component library already present in the repo. If none exists and the user did not explicitly ask for a bespoke internal UI kit, use a standard, widely used open-source design-system component library appropriate to the stack instead of inventing one-off primitives. Only create a new local shared component library when the user explicitly asks for it or the repo already follows that pattern.
- Return complete, working code — no placeholders or TODOs.`);

  if (config.impl?.context) {
    lines.push(`\n## Project Context\n${config.impl.context}`);
  }
  appendScaffoldContext(lines, writePolicy.scaffoldState);

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
  const writePolicyWithContext = {
    ...writePolicy,
    scaffoldState: options.scaffoldState || null,
  };
  if (providerReadsWorkspace(options.provider)) {
    return buildRepoAwarePrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicyWithContext, options.evidenceFiles || []);
  }
  return buildEmbeddedPrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicyWithContext);
}

function compactThreadMemo(cwd, teamConfig) {
  const thread = readImplementationThread(cwd);
  return {
    thread,
    memo: buildImplementationMemo(thread, teamConfig.memoHistory),
  };
}

function buildStrategyContext({
  cwd,
  vpFiles,
  genFiles,
  editableFiles,
  config,
  errors,
  writePolicy,
  provider,
  evidenceFiles,
  orchestration,
}) {
  const teamConfig = normalizeImplementationTeam(config.impl);
  const { memo } = compactThreadMemo(cwd, teamConfig);
  const scaffoldState = readScaffoldState(cwd);
  return {
    teamConfig,
    memo,
    orchestration: orchestration || {},
    provider,
    prompt: buildPrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy, {
      provider,
      evidenceFiles,
      scaffoldState,
    }),
  };
}

function strategyOutputShape() {
  return `{
  "summary": "short diagnosis",
  "approach": "what implementation direction to take next",
  "changed_approach": true,
  "root_causes": ["root cause 1", "root cause 2"],
  "continue_iteration": true,
  "stop_reason": "",
  "next_task": {
    "task_id": "api-filter-active-todos",
    "role": "architecture|ui|api|database|security|technical",
    "goal": "specific one-shot coding goal for this specialist",
    "why_now": "why this one shot should run now",
    "focus_types": ["ui", "api"],
    "target_groups": ["api", "behavior_gherkin"],
    "target_evidence": ["evidence/run.json", "evidence/api.json"],
    "instructions": ["specific instruction", "specific instruction"],
    "done_when": ["clear completion signal", "clear completion signal"]
  }
}`;
}

function specialistBlockerReportShape() {
  return `{
  "status": "blocked",
  "summary": "short explanation of why the narrow slice could not find a simple safe fix",
  "exhausted_simple_paths": true,
  "tried": ["small idea already tried", "small idea already tried"],
  "blockers": ["what is actually blocking the slice now"],
  "handoff_role": "architecture|ui|api|database|security|technical|null",
  "suggested_next_step": "what the orchestrator should try next"
}`;
}

const SPECIALIST_LABELS = {
  architecture: "shipflow-architecture-specialist",
  ui: "shipflow-ui-specialist",
  api: "shipflow-api-specialist",
  database: "shipflow-database-specialist",
  security: "shipflow-security-specialist",
  technical: "shipflow-technical-specialist",
};

const CLAUDE_AGENT_TYPES = {
  strategy: "shipflow-strategy-lead",
  architecture: SPECIALIST_LABELS.architecture,
  ui: SPECIALIST_LABELS.ui,
  api: SPECIALIST_LABELS.api,
  database: SPECIALIST_LABELS.database,
  security: SPECIALIST_LABELS.security,
  technical: SPECIALIST_LABELS.technical,
};

const KIRO_AGENT_TYPES = {
  strategy: "shipflow-strategy-lead",
  architecture: SPECIALIST_LABELS.architecture,
  ui: SPECIALIST_LABELS.ui,
  api: SPECIALIST_LABELS.api,
  database: SPECIALIST_LABELS.database,
  security: SPECIALIST_LABELS.security,
  technical: SPECIALIST_LABELS.technical,
};

const CODEX_AGENT_TYPES = {
  strategy: "shipflow_strategy_lead",
  architecture: "shipflow_architecture_specialist",
  ui: "shipflow_ui_specialist",
  api: "shipflow_api_specialist",
  database: "shipflow_database_specialist",
  security: "shipflow_security_specialist",
  technical: "shipflow_technical_specialist",
};

function nativeStrategyLeadPreamble(provider) {
  if (provider === "codex") {
    return [
      "Use Codex native multi-agent roles configured in .codex/config.toml.",
      `Strategy role: \`${CODEX_AGENT_TYPES.strategy}\`.`,
      `Available specialist agent_types: ${Object.entries(CODEX_AGENT_TYPES)
        .filter(([key]) => key !== "strategy")
        .map(([, value]) => `\`${value}\``)
        .join(", ")}.`,
      "Delegate via Codex native multi-agent roles, not via broad generic workers or skill-only routing.",
      "Keep every delegated agent tied to one narrow verification slice and the smallest evidence set that can unblock it.",
    ].join("\n");
  }
  if (provider === "gemini") {
    return [
      "/shipflow:strategy-lead",
      "",
      "Use the native Gemini custom commands installed by the ShipFlow extension.",
      `Available specialist commands: ${Object.values(SPECIALIST_LABELS).map(name => `/shipflow:${name.replace(/^shipflow-/, "")}`).join(", ")}.`,
      "Keep every command invocation tied to one narrow verification slice and the smallest evidence set that can unblock it.",
    ].join("\n");
  }
  if (provider === "claude") {
    return [
      `Installed ShipFlow Claude agents in ~/.claude/agents: \`${CLAUDE_AGENT_TYPES.strategy}\`, ${Object.values(SPECIALIST_LABELS).map(name => `\`${name}\``).join(", ")}.`,
      "This strategy step is orchestration only. Return the compact specialist plan directly from the provided context.",
      "Do not open a Task and do not spawn another agent during planning; save the native Claude agents for the specialist implementation slices.",
    ].join("\n");
  }
  if (provider === "kiro") {
    return [
      "Use Kiro native custom agents via the subagent tool.",
      `Installed ShipFlow agents in ~/.kiro/agents: \`shipflow-strategy-lead\`, ${Object.values(SPECIALIST_LABELS).map(name => `\`${name}\``).join(", ")}.`,
      "Delegate only the smallest specialist task that can move a blocker verification from red to green.",
    ].join("\n");
  }
  return "";
}

function nativeSpecialistPreamble(provider, role) {
  const specialistName = SPECIALIST_LABELS[role] || "shipflow-architecture-specialist";
  if (provider === "codex") {
    return [
      "Use Codex native multi-agent roles configured in .codex/config.toml.",
      `Preferred agent_type for this slice: \`${CODEX_AGENT_TYPES[role] || CODEX_AGENT_TYPES.architecture}\`.`,
      "If a dependency from another slice blocks you, ask Codex to delegate only that narrow dependency to the matching specialist agent_type.",
    ].join("\n");
  }
  if (provider === "gemini") {
    return [
      `/shipflow:${specialistName.replace(/^shipflow-/, "")}`,
      "",
      "Use the native Gemini custom command named above and keep the work inside one narrow verification slice.",
    ].join("\n");
  }
  if (provider === "claude") {
    return [
      `You are running as the Claude native agent \`${specialistName}\`.`,
      "Work this slice directly in your own clean context.",
      "Use the Task tool only if a tiny dependency from another slice must be inspected, and keep that nested task extremely small.",
    ].join("\n");
  }
  if (provider === "kiro") {
    return [
      "Use Kiro native custom agents via the subagent tool.",
      `Preferred ShipFlow agent for this slice: \`${specialistName}\`.`,
      "If a dependency from another slice blocks you, delegate only that dependency and keep the nested task tiny.",
    ].join("\n");
  }
  return "";
}

export function buildStrategyPrompt(context) {
  const { teamConfig, memo, orchestration, prompt, provider } = context;
  const roleCatalog = teamConfig.roles.map(role => {
    const def = IMPLEMENTATION_SPECIALIST_ROLES[role];
    return `- ${role}: ${def.title}. ${def.focus}`;
  }).join("\n");
  const lines = [];
  const nativePreamble = nativeStrategyLeadPreamble(provider);
  if (nativePreamble) lines.push(nativePreamble, "");
  lines.push(
    "You are the ShipFlow strategy lead for the implementation loop.",
    "You are not writing code in this step. You are deciding the single next micro-task for the specialist team.",
    "Goal: maximize newly passing blocker verifications by sending one narrowly scoped one-shot task at a time.",
    "The team must behave like a human engineering group: diagnose first, send a tiny specialist slice, inspect the result, then choose the next slice.",
    "",
    "Available specialist roles:",
    roleCatalog,
    "",
    "Rules:",
    "- Return at most one `next_task`.",
    "- Keep the task tiny, specific, and one-shot.",
    "- Delegate a narrow verification slice, not the whole project.",
    "- Prefer tasks like 'make GET /api/todos?filter=active green' or 'repair SQLite persistence after restart' over generic rewrites.",
    "- It is valid to choose the same specialist role again later in the iteration with a different tiny task. Do not bundle those tasks together now.",
    "- Use the provider's native delegation mechanism so each specialist keeps a clean context window.",
    "- The orchestrator owns the global loop; specialists should own their local slice only.",
    "- Tell specialists to come back when they have exhausted the straightforward ideas inside their slice. Do not make them grind on speculative wide rewrites just to stay busy.",
    "- You will be called again after each specialist result, so do not pre-plan the whole round.",
    "- If the current workspace is ready for verification, return `continue_iteration: false` with a short `stop_reason` and no `next_task`.",
    "- If the run is stagnating or no new checks passed recently, you MUST choose a materially different approach.",
    "- Prefer root-cause fixes over symptom patches.",
    "- Do not spend specialist tasks on ShipFlow internals such as `.shipflow/**`, draft sessions, `vp.lock.json`, `.gen/**`, or status-only refreshes unless the evidence explicitly proves the framework itself is blocked there.",
    "- If blocker verifications are failing in the app/runtime, choose an app/runtime slice next. Do not invent meta maintenance work just because those internal files exist.",
    "- Treat the compact implementation memo as the continuity thread. Do not ask for the full history again.",
    "",
    `Current iteration: ${orchestration.iteration || 1}/${orchestration.maxIterations || "?"}`,
    `Current one-shot task: ${orchestration.taskIndex || 1}/${orchestration.maxTasksPerIteration || teamConfig.maxTasksPerIteration}`,
    `Remaining duration budget ms: ${orchestration.remainingDurationMs ?? "unknown"}`,
    `Current stagnation streak: ${orchestration.stagnationCount || 0}`,
    `Changed approach required: ${orchestration.mustChangeStrategy ? "yes" : "no"}`,
    "",
    "Compact implementation memo:",
    "```json",
    JSON.stringify(memo, null, 2),
    "```",
    "",
    "Specialist results already completed in this iteration:",
    "```json",
    JSON.stringify(orchestration.taskResults || [], null, 2),
    "```",
    "",
    "Return JSON only with this exact shape:",
    "```json",
    strategyOutputShape(),
    "```",
    "",
    "Base implementation context:",
    prompt,
  );
  return lines.join("\n");
}

function normalizeStrategyTask(task, teamConfig) {
  const allowedRoles = new Set(teamConfig.roles);
  const role = normalizeSpecialistRole(
    task?.role
      || task?.specialist_role
      || task?.specialist
      || task?.owner
      || task?.area
      || task?.focus,
    teamConfig,
  );
  if (!allowedRoles.has(role)) return null;
  return {
    task_id: String(task?.task_id || task?.taskId || `${role}-slice`).trim() || `${role}-slice`,
    role,
    goal: String(task?.goal || "").trim(),
    why_now: String(task?.why_now || task?.whyNow || "").trim(),
    focus_types: Array.isArray(task?.focus_types || task?.focusTypes)
      ? (task.focus_types || task.focusTypes).map(String).slice(0, 8)
      : [],
    target_groups: Array.isArray(task?.target_groups || task?.targetGroups)
      ? (task.target_groups || task.targetGroups).map(String).slice(0, 8)
      : [],
    target_evidence: Array.isArray(task?.target_evidence || task?.targetEvidence)
      ? (task.target_evidence || task.targetEvidence).map(String).slice(0, 12)
      : [],
    instructions: Array.isArray(task?.instructions) ? task.instructions.map(String).slice(0, 8) : [],
    done_when: Array.isArray(task?.done_when || task?.doneWhen)
      ? (task.done_when || task.doneWhen).map(String).slice(0, 8)
      : [],
  };
}

function normalizeSpecialistRole(value, teamConfig = { roles: Object.keys(IMPLEMENTATION_SPECIALIST_ROLES) }) {
  const allowedRoles = new Set(Array.isArray(teamConfig?.roles) ? teamConfig.roles : Object.keys(IMPLEMENTATION_SPECIALIST_ROLES));
  const raw = String(value || "").trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase().trim();
  if (allowedRoles.has(lowered)) return lowered;

  const compact = lowered
    .replace(/[_-]+/g, " ")
    .replace(/\b(lead|specialist|engineer|team|owner)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return null;

  const aliasEntries = [
    [["architecture", "system", "integration"], "architecture"],
    [["ui", "frontend", "front end", "client"], "ui"],
    [["api", "backend", "back end", "server", "graphql", "rest"], "api"],
    [["database", "db", "data", "persistence", "storage"], "database"],
    [["security", "auth", "authorization", "authentication"], "security"],
    [["technical", "runtime", "tooling", "dependencies", "infrastructure"], "technical"],
  ];

  for (const [aliases, role] of aliasEntries) {
    if (!allowedRoles.has(role)) continue;
    if (aliases.some(alias => compact === alias || compact.includes(alias))) return role;
  }

  return null;
}

function buildStrategyTaskCandidate(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.next_task && typeof parsed.next_task === "object") return parsed.next_task;
  if (parsed.nextTask && typeof parsed.nextTask === "object") return parsed.nextTask;
  if (parsed.task && typeof parsed.task === "object") return parsed.task;
  if (Array.isArray(parsed.tasks)) {
    const firstTask = parsed.tasks.find(item => item && typeof item === "object");
    if (firstTask) return firstTask;
  }
  const role = parsed.next_role || parsed.nextRole || parsed.role || parsed.specialist_role || parsed.specialistRole;
  if (!role) return null;
  return {
    task_id: parsed.task_id || parsed.taskId || "",
    role,
    goal: parsed.goal || parsed.summary || "",
    why_now: parsed.why_now || parsed.whyNow || "",
    focus_types: parsed.focus_types || parsed.focusTypes || parsed.target_groups || parsed.targetGroups || [],
    target_groups: parsed.target_groups || parsed.targetGroups || parsed.focus_types || parsed.focusTypes || [],
    target_evidence: parsed.target_evidence || parsed.targetEvidence || [],
    instructions: parsed.instructions || [],
    done_when: parsed.done_when || parsed.doneWhen || [],
  };
}

function parseStrategyDecision(text, fallback, teamConfig) {
  const normalized = normalizeProviderText(text, "json");
  const parsed = JSON.parse(normalized);
  const requestedStop = parsed?.continue_iteration === false;
  const taskCandidate = buildStrategyTaskCandidate(parsed);
  const nextTask = requestedStop
    ? null
    : (normalizeStrategyTask(taskCandidate, teamConfig) || fallback.next_task || null);
  return {
    summary: String(parsed?.summary || fallback.summary || "").trim(),
    approach: String(parsed?.approach || fallback.approach || "").trim(),
    changed_approach: Boolean(parsed?.changed_approach || false),
    continue_iteration: requestedStop ? false : Boolean(nextTask),
    stop_reason: String(parsed?.stop_reason || fallback.stop_reason || "").trim(),
    root_causes: Array.isArray(parsed?.root_causes)
      ? parsed.root_causes.map(String).slice(0, 8)
      : (Array.isArray(fallback.root_causes) ? fallback.root_causes : []),
    next_task: nextTask,
    tasks: nextTask ? [nextTask] : [],
  };
}

function buildStrategyRepairPrompt(basePrompt, providerText, parseError) {
  const reply = String(providerText || "").trim();
  const excerpt = reply.length > 2000 ? reply.slice(0, 2000) + "\n...[truncated]" : reply;
  return [
    basePrompt,
    "",
    "## Strategy JSON Correction",
    "Your previous reply was not valid JSON for the ShipFlow strategy plan.",
    "Return only valid JSON matching the required shape. Do not include markdown fences or commentary.",
    "",
    `Parse error: ${parseError}`,
    "",
    "Previous invalid reply:",
    "```text",
    excerpt,
    "```",
  ].join("\n");
}

async function analyzeImplementationStrategy({
  cwd,
  vpFiles,
  genFiles,
  editableFiles,
  config,
  errors,
  writePolicy,
  provider,
  model,
  maxTokens,
  timeoutMs,
  providerOptions,
  evidenceFiles,
  orchestration,
  generateWithProviderImpl,
  logger,
}) {
  const context = buildStrategyContext({
    cwd,
    vpFiles,
    genFiles,
    editableFiles,
    config,
    errors,
    writePolicy,
    provider,
    evidenceFiles,
    orchestration,
  });
  const fallback = fallbackStrategyDecision({
    run: context.memo?.recent_attempts?.at(-1)?.verify
      ? {
          failing_groups: (context.memo.recent_attempts.at(-1).verify.failing_groups || []).map(label => ({ label })),
        }
      : null,
    team: context.teamConfig,
    verificationTypes: verificationTypesFromVpFiles(vpFiles),
    attemptedRoles: Array.isArray(orchestration?.taskResults)
      ? orchestration.taskResults.map(item => item.role).filter(Boolean)
      : [],
  });
  logger?.log({
    actorType: "strategy",
    actorId: "strategy-lead",
    event: "strategy.started",
    message: `Strategy lead started planning iteration ${Number(orchestration?.iteration || 1)}.`,
    iteration: orchestration?.iteration ?? null,
    stage: "impl",
    data: {
      must_change_strategy: Boolean(orchestration?.mustChangeStrategy),
      evidence_files: evidenceFiles.slice(0, 6),
      fallback_role: fallback.next_task?.role || null,
    },
  });
  if (provider === "claude") {
    const deterministicPlan = {
      ...fallback,
      summary: "Deterministic next-task routing for Claude headless mode.",
      approach: orchestration?.mustChangeStrategy
        ? "Change approach by re-routing the next one-shot slice to a different failing surface before verifying again."
        : fallback.approach,
      changed_approach: Boolean(orchestration?.mustChangeStrategy),
    };
    logger?.log({
      actorType: "strategy",
      actorId: "strategy-lead",
      event: "strategy.local_planner_used",
      message: "ShipFlow used deterministic next-task routing for Claude before delegating the native specialist agent.",
      iteration: orchestration?.iteration ?? null,
      stage: "impl",
      data: {
        next_role: deterministicPlan.next_task?.role || null,
      },
    });
    return deterministicPlan;
  }
  let prompt = buildStrategyPrompt(context);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const text = await generateWithProviderImpl({
      provider,
      model,
      maxTokens,
      prompt,
      cwd,
      options: {
        ...providerOptions,
        ...(provider === "kiro" ? { agent: KIRO_AGENT_TYPES.strategy } : {}),
      },
      responseFormat: "json",
      timeoutMs,
    });
    try {
      const strategyPlan = parseStrategyDecision(text, fallback, context.teamConfig);
      logger?.log({
        actorType: "strategy",
        actorId: "strategy-lead",
        event: "strategy.completed",
        message: strategyPlan.continue_iteration
          ? `Strategy lead selected the next ${strategyPlan.next_task?.role || "specialist"} one-shot task.`
          : "Strategy lead decided the iteration is ready to verify.",
        iteration: orchestration?.iteration ?? null,
        stage: "impl",
        data: {
          approach: strategyPlan.approach,
          changed_approach: Boolean(strategyPlan.changed_approach),
          continue_iteration: Boolean(strategyPlan.continue_iteration),
          next_role: strategyPlan.next_task?.role || null,
          stop_reason: strategyPlan.stop_reason || "",
        },
      });
      return strategyPlan;
    } catch (error) {
      if (attempt === 2) break;
      logger?.log({
        actorType: "strategy",
        actorId: "strategy-lead",
        event: "strategy.repair_requested",
        message: "Strategy lead returned invalid JSON; requesting a corrected strategy reply.",
        iteration: orchestration?.iteration ?? null,
        stage: "impl",
        data: {
          attempt,
          parse_error: error instanceof Error ? error.message : "invalid json",
        },
      });
      prompt = buildStrategyRepairPrompt(prompt, text, error instanceof Error ? error.message : "invalid json");
    }
  }
  logger?.log({
    actorType: "strategy",
    actorId: "strategy-lead",
    event: "strategy.fallback_used",
    message: "Strategy lead did not return valid JSON; ShipFlow used a fallback next task.",
    iteration: orchestration?.iteration ?? null,
    stage: "impl",
    data: {
      next_role: fallback.next_task?.role || null,
    },
  });
  return fallback;
}

function specialistRoleInstructions(role) {
  const spec = IMPLEMENTATION_SPECIALIST_ROLES[role] || IMPLEMENTATION_SPECIALIST_ROLES.architecture;
  return [
    `You are the ${spec.title} on the ShipFlow implementation team.`,
    `Role focus: ${spec.focus}`,
    "You are not alone in the codebase. Other specialists may have changed files before you in this same iteration.",
    "Do not undo another specialist's correct work. Adjust your changes to integrate with what is already in the workspace.",
    "Stay focused on your assigned goal, but make the real root-cause fix if the failure crosses layers.",
    "This is a one-shot task. Keep it narrow and finish as soon as the smallest viable slice is done.",
    "Work on your assigned verification slice instead of trying to solve the whole project.",
    "Use the provider's native delegation mechanism to preserve clean contexts for subproblems inside your slice.",
    "If you exhaust the straightforward ideas inside your slice and the next step would be broad, speculative, or owned by another specialist, return early with a blocker report instead of grinding longer.",
    "Do not stay in your own loop after the slice is done. Return immediately so the orchestrator can choose the next micro-task.",
  ].join("\n");
}

export function buildSpecialistPrompt(basePrompt, assignment, orchestration = {}, provider = null) {
  const lines = [];
  const nativePreamble = nativeSpecialistPreamble(provider, assignment.role);
  if (nativePreamble) lines.push(nativePreamble, "");
  lines.push(
    specialistRoleInstructions(assignment.role),
    "",
    `Task id: ${assignment.task_id || `${assignment.role}-slice`}`,
    `Assigned goal: ${assignment.goal || "repair the failing verification surface assigned to you."}`,
  );
  if (assignment.why_now) lines.push(`Why now: ${assignment.why_now}`);
  if (assignment.focus_types?.length > 0) lines.push(`Focus verification types: ${assignment.focus_types.join(", ")}`);
  if (assignment.target_groups?.length > 0) lines.push(`Assigned verification slice: ${assignment.target_groups.join(", ")}`);
  if (assignment.target_evidence?.length > 0) {
    lines.push("Read this evidence first:");
    for (const file of assignment.target_evidence) lines.push(`- ${file}`);
  }
  if (assignment.instructions?.length > 0) {
    lines.push("Assignment instructions:");
    for (const instruction of assignment.instructions) lines.push(`- ${instruction}`);
  }
  if (assignment.done_when?.length > 0) {
    lines.push("Done when:");
    for (const item of assignment.done_when) lines.push(`- ${item}`);
  }
  if (orchestration.memo) {
    lines.push("Compact implementation memo:");
    lines.push("```json");
    lines.push(JSON.stringify(orchestration.memo, null, 2));
    lines.push("```");
  }
  if (orchestration.mustChangeStrategy) {
    lines.push("This run is stagnating. You must try a materially different fix path than the last failed attempts.");
  }
  lines.push("Use a local inner loop for your slice: inspect only the relevant verifications/evidence, reason about the narrow fix, and return only the files needed for that slice.");
  lines.push("");
  lines.push(basePrompt);
  lines.push("");
  lines.push("## Specialist Return Rule");
  lines.push("If you found a concrete fix in your slice, return ShipFlow file blocks only.");
  lines.push("If you exhausted the straightforward ideas in your slice and there is no simple safe fix left without broadening scope, return JSON only with this exact shape:");
  lines.push("```json");
  lines.push(specialistBlockerReportShape());
  lines.push("```");
  lines.push("Use the blocker report only when `exhausted_simple_paths` is true. Prefer returning early with a crisp handoff over speculative thrashing.");
  return lines.join("\n");
}

function parseJsonObjectReply(text) {
  const normalized = normalizeProviderText(text, "json");
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const candidate = findBalancedJsonObject(text);
    if (!candidate) return null;
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function normalizeSpecialistBlockerReport(text, assignment) {
  const parsed = parseJsonObjectReply(text);
  if (!parsed || parsed.status !== "blocked" || parsed.exhausted_simple_paths !== true) return null;
  const summary = String(parsed.summary || "").trim();
  if (!summary) return null;
  const handoffRole = normalizeSpecialistRole(parsed.handoff_role);
  return {
    task_id: assignment.task_id || null,
    role: assignment.role,
    goal: assignment.goal || "",
    status: "blocked",
    written_files: [],
    blocker_report: {
      summary,
      exhausted_simple_paths: true,
      tried: Array.isArray(parsed.tried) ? parsed.tried.map(String).map(item => item.trim()).filter(Boolean).slice(0, 8) : [],
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers.map(String).map(item => item.trim()).filter(Boolean).slice(0, 8) : [],
      handoff_role: handoffRole,
      suggested_next_step: String(parsed.suggested_next_step || "").trim(),
    },
  };
}

function invalidSpecialistOutputResult(assignment, summary, issues = []) {
  const normalizedIssues = Array.isArray(issues)
    ? issues.map(String).map(item => item.trim()).filter(Boolean).slice(0, 8)
    : [];
  const handoffRole = normalizedIssues.some(issue => /syntaxerror|invalid javascript syntax|unexpected token|missing \)/i.test(issue))
    ? (assignment.role === "technical" ? "technical" : "technical")
    : assignment.role;
  return {
    task_id: assignment.task_id || null,
    role: assignment.role,
    goal: assignment.goal || "",
    status: "blocked",
    written_files: [],
    blocker_report: {
      summary,
      exhausted_simple_paths: true,
      tried: ["requested a stricter correction from the same specialist"],
      blockers: normalizedIssues,
      handoff_role: handoffRole,
      suggested_next_step: normalizedIssues.length > 0
        ? `Re-plan the slice with these concrete validation issues in mind: ${normalizedIssues.join("; ")}`
        : "Re-plan the slice with a narrower specialist task or a different specialist.",
    },
  };
}

function buildSpecialistReturnRepairPrompt(basePrompt, providerText) {
  const reply = String(providerText || "").trim();
  const excerpt = reply.length > 2000 ? reply.slice(0, 2000) + "\n...[truncated]" : reply;
  return [
    basePrompt,
    "",
    "## Specialist Return Correction",
    "Your previous reply was neither valid ShipFlow file blocks nor a valid blocker JSON report.",
    "If you found a concrete fix, return only ShipFlow file blocks.",
    "If you exhausted the straightforward ideas in your slice, return only blocker JSON with this exact shape:",
    "```json",
    specialistBlockerReportShape(),
    "```",
    "",
    "Previous invalid reply:",
    "```text",
    excerpt,
    "```",
  ].join("\n");
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

function findBalancedJsonObject(text) {
  const source = String(text || "");
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;
    const stack = ["{"];
    let inString = false;
    let escape = false;
    for (let index = start + 1; index < source.length; index += 1) {
      const ch = source[index];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") {
        stack.push(ch);
        continue;
      }
      if (ch === "}") {
        if (stack.at(-1) !== "{") break;
        stack.pop();
        if (stack.length === 0) {
          const candidate = source.slice(start, index + 1).trim();
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return `${candidate}\n`;
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

export function sanitizeGeneratedFiles(files) {
  return (files || []).map(file => {
    const normalizedPath = String(file?.path || "").trim().toLowerCase();
    if (!normalizedPath.endsWith(".json")) return file;
    const content = String(file?.content || "");
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return file;
    } catch {
      const candidate = findBalancedJsonObject(content);
      if (candidate) return { ...file, content: candidate };
    }
    return file;
  });
}

function summarizePlaceholderContent(content) {
  return String(content || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function placeholderIssueForFile(file) {
  const normalizedPath = String(file?.path || "").trim();
  const trimmed = String(file?.content || "").trim();
  if (!normalizedPath || !trimmed) return null;

  const exactPlaceholderPatterns = [
    /^\[(?:full file content(?: [^\]]*)?|rest of (?:the )?file(?: [^\]]*)?|same as above|unchanged(?: [^\]]*)?|omitted(?: for brevity)?|truncated(?: [^\]]*)?|existing content(?: unchanged)?)\]$/i,
    /^(?:\/\/|#|<!--)\s*(?:full file content(?: [^>]*)?|rest of (?:the )?file(?: [^>]*)?|same as above|unchanged(?: [^>]*)?|omitted(?: for brevity)?|truncated(?: [^>]*)?|existing content(?: unchanged)?)\s*(?:-->)?$/i,
  ];
  if (exactPlaceholderPatterns.some(pattern => pattern.test(trimmed))) {
    return `${normalizedPath}: placeholder content is not allowed (${summarizePlaceholderContent(trimmed)})`;
  }

  const lowSignalPlaceholderPhrases = [
    "full file content as shown above",
    "rest of file unchanged",
    "rest of the file unchanged",
    "same as above",
    "omitted for brevity",
    "existing content unchanged",
    "truncated for brevity",
  ];
  const lowered = trimmed.toLowerCase();
  if (trimmed.length <= 240 && lowSignalPlaceholderPhrases.some(phrase => lowered.includes(phrase))) {
    return `${normalizedPath}: placeholder content is not allowed (${summarizePlaceholderContent(trimmed)})`;
  }

  return null;
}

export function validateGeneratedFiles(files) {
  const issues = [];
  const syntaxCandidates = [];
  for (const file of files || []) {
    const normalizedPath = String(file?.path || "").trim();
    if (!normalizedPath) {
      issues.push("A returned file block is missing its path.");
      continue;
    }
    const placeholderIssue = placeholderIssueForFile(file);
    if (placeholderIssue) {
      issues.push(placeholderIssue);
      continue;
    }
    if (normalizedPath.toLowerCase().endsWith(".json")) {
      try {
        const parsed = JSON.parse(String(file.content || ""));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          issues.push(`${normalizedPath}: JSON root must be an object.`);
        }
      } catch (error) {
        issues.push(`${normalizedPath}: ${(error && error.message) || "invalid JSON"}`);
      }
      continue;
    }
    syntaxCandidates.push(file);
  }
  for (const issue of validateGeneratedSourceSyntax(syntaxCandidates)) issues.push(issue);
  return issues;
}

function isJavaScriptSyntaxCheckTarget(filePath) {
  const normalized = String(filePath || "").trim().toLowerCase();
  return normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs");
}

function summarizeSyntaxFailure(output = "") {
  const cleaned = String(output || "").trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (cleaned.length === 0) return "invalid JavaScript syntax";
  const explicitSyntaxError = cleaned.find(line => /SyntaxError/i.test(line));
  if (explicitSyntaxError) return explicitSyntaxError;
  const informative = cleaned.filter(line => !/^node\.js v/i.test(line));
  return informative.slice(0, 4).join(" ");
}

function validateGeneratedSourceSyntax(files) {
  const issues = [];
  for (const file of files || []) {
    const normalizedPath = String(file?.path || "").trim();
    if (!normalizedPath || !isJavaScriptSyntaxCheckTarget(normalizedPath)) continue;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-syntax-"));
    const tempPath = path.join(tmpDir, path.basename(normalizedPath));
    try {
      fs.writeFileSync(tempPath, String(file.content || ""), "utf-8");
      const result = spawnSync(process.execPath, ["--check", tempPath], {
        stdio: "pipe",
        encoding: "utf-8",
      });
      if (result.status === 0) continue;
      issues.push(`${normalizedPath}: ${summarizeSyntaxFailure(result.stderr || result.stdout)}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
  return issues;
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

export function buildFileContentRepairPrompt(basePrompt, providerText, issues = []) {
  const reply = String(providerText || "").trim();
  const excerpt = reply.length > 2000 ? reply.slice(0, 2000) + "\n...[truncated]" : reply;
  return [
    basePrompt,
    "",
    "## Content Correction",
    "Your previous reply included ShipFlow file blocks, but one or more file contents were invalid.",
    "Fix the content issues below and return the corrected file blocks only.",
    "Any *.json file you return must be valid JSON with an object at the root.",
    "Do not use placeholder content such as [full file content as shown above], [rest of file unchanged], or similar ellipses/referrals.",
    "",
    ...issues.map(issue => `- ${issue}`),
    "",
    "Return only file blocks using the exact markers below. Do not return commentary.",
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

async function requestFilesFromSpecialist({
  assignment,
  basePrompt,
  cwd,
  provider,
  model,
  maxTokens,
  timeoutMs,
  providerOptions,
  generateWithProviderImpl,
  writePolicy,
  orchestration,
  logger,
}) {
  let currentPrompt = buildSpecialistPrompt(basePrompt, assignment, orchestration, provider);
  let text = "";
  let files = [];
  let validationIssues = [];
  let blockerResult = null;
  logger?.log({
    actorType: "specialist",
    actorId: assignment.role,
    event: "specialist.started",
    message: `${assignment.role} specialist started its scoped implementation slice.`,
    iteration: orchestration?.iteration ?? null,
    stage: "impl",
    data: {
      task_id: assignment.task_id || null,
      goal: assignment.goal || "",
      target_groups: assignment.target_groups || [],
      target_evidence: assignment.target_evidence || [],
      done_when: assignment.done_when || [],
    },
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    text = await generateWithProviderImpl({
      provider,
      model,
      maxTokens,
      prompt: currentPrompt,
      cwd,
      options: {
        ...providerOptions,
        ...(provider === "claude" ? { agent: CLAUDE_AGENT_TYPES[assignment.role] || CLAUDE_AGENT_TYPES.architecture } : {}),
        ...(provider === "kiro" ? { agent: KIRO_AGENT_TYPES[assignment.role] || KIRO_AGENT_TYPES.architecture } : {}),
      },
      responseFormat: "files",
      timeoutMs,
    });
    files = sanitizeGeneratedFiles(parseFiles(text));
    validationIssues = files.length > 0 ? validateGeneratedFiles(files) : [];
    blockerResult = files.length === 0 ? normalizeSpecialistBlockerReport(text, assignment) : null;
    if (blockerResult) {
      logger?.log({
        actorType: "specialist",
        actorId: assignment.role,
        event: "specialist.blocked",
        message: blockerResult.blocker_report.summary,
        iteration: orchestration?.iteration ?? null,
        stage: "impl",
        data: {
          tried: blockerResult.blocker_report.tried,
          blockers: blockerResult.blocker_report.blockers,
          handoff_role: blockerResult.blocker_report.handoff_role || null,
          suggested_next_step: blockerResult.blocker_report.suggested_next_step || "",
        },
      });
      return blockerResult;
    }
    if (files.length > 0 && validationIssues.length === 0) break;
    if (attempt >= 3) break;
    if (files.length === 0) {
      logger?.log({
        actorType: "specialist",
        actorId: assignment.role,
        event: "specialist.repair_requested",
        message: `${assignment.role} specialist returned neither file blocks nor a valid blocker report; requesting a correction.`,
        iteration: orchestration?.iteration ?? null,
        stage: "impl",
        data: {
          attempt,
        },
      });
      currentPrompt = buildSpecialistReturnRepairPrompt(currentPrompt, text);
      continue;
    }
    logger?.log({
      actorType: "specialist",
      actorId: assignment.role,
      event: "specialist.repair_requested",
      message: `${assignment.role} specialist returned invalid file content; requesting corrected file blocks.`,
      iteration: orchestration?.iteration ?? null,
      stage: "impl",
      data: {
        attempt,
        issues: validationIssues,
      },
    });
    currentPrompt = buildFileContentRepairPrompt(currentPrompt, text, validationIssues);
  }

  if (files.length === 0) {
    const invalidResult = invalidSpecialistOutputResult(
      assignment,
      `${assignment.role} specialist did not return valid file blocks after correction attempts.`,
    );
    logger?.log({
      actorType: "specialist",
      actorId: assignment.role,
      event: "specialist.blocked",
      message: invalidResult.blocker_report.summary,
      iteration: orchestration?.iteration ?? null,
      stage: "impl",
      data: {
        blockers: invalidResult.blocker_report.blockers,
        handoff_role: invalidResult.blocker_report.handoff_role || null,
        suggested_next_step: invalidResult.blocker_report.suggested_next_step || "",
      },
    });
    return invalidResult;
  }
  if (validationIssues.length > 0) {
    const invalidResult = invalidSpecialistOutputResult(
      assignment,
      `${assignment.role} specialist still returned invalid file content after correction attempts.`,
      validationIssues,
    );
    logger?.log({
      actorType: "specialist",
      actorId: assignment.role,
      event: "specialist.blocked",
      message: invalidResult.blocker_report.summary,
      iteration: orchestration?.iteration ?? null,
      stage: "impl",
      data: {
        blockers: invalidResult.blocker_report.blockers,
        handoff_role: invalidResult.blocker_report.handoff_role || null,
        suggested_next_step: invalidResult.blocker_report.suggested_next_step || "",
      },
    });
    return invalidResult;
  }

  const allowed = files.filter(file => isAllowedImplPath(file.path, writePolicy));
  const rejected = files.filter(file => !isAllowedImplPath(file.path, writePolicy));
  if (rejected.length > 0) {
    logger?.log({
      actorType: "specialist",
      actorId: assignment.role,
      event: "specialist.rejected_files",
      message: `${assignment.role} specialist proposed file writes outside the allowed targets.`,
      iteration: orchestration?.iteration ?? null,
      stage: "impl",
      data: {
        rejected_paths: rejected.map(file => file.path),
      },
    });
    console.warn(
      `ShipFlow impl: ${assignment.role} specialist returned ${rejected.length} file(s) outside the allowed write targets: ` +
      rejected.map(f => f.path).join(", ")
    );
  }

  for (const file of allowed) {
    const fullPath = path.join(cwd, file.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content, "utf-8");
  }

  logger?.log({
    actorType: "specialist",
    actorId: assignment.role,
    event: "specialist.completed",
    message: `${assignment.role} specialist wrote ${allowed.length} file(s).`,
    iteration: orchestration?.iteration ?? null,
    stage: "impl",
    data: {
      task_id: assignment.task_id || null,
      written_files: allowed.map(file => file.path),
      rejected_files: rejected.map(file => file.path),
    },
  });

  return {
    task_id: assignment.task_id || null,
    role: assignment.role,
    goal: assignment.goal || "",
    status: "wrote",
    written_files: allowed.map(file => file.path),
  };
}

export async function impl({ cwd, errors, provider, model, orchestration = {}, deps = {} }) {
  const { config, provider: resolvedProvider, model: resolvedModel, maxTokens, timeoutMs, writePolicy, providerOptions } = resolveImplOptions(cwd, { provider, model });
  const generateWithProviderImpl = deps.generateWithProvider || generateWithProvider;
  const teamConfig = normalizeImplementationTeam(config.impl);
  const logger = orchestration.logger || createImplementationLogger({
    cwd,
    provider: resolvedProvider,
    model: resolvedModel,
  });

  const vpFiles = collectFiles(path.join(cwd, "vp"), cwd);
  const genFiles = collectGeneratedArtifacts(cwd);
  const scaffoldState = readScaffoldState(cwd);

  const specialistResults = [];
  const strategyDecisions = [];
  const writtenFiles = new Set();
  let stopReason = "";

  for (let taskIndex = 1; taskIndex <= teamConfig.maxTasksPerIteration; taskIndex += 1) {
    const editableFiles = collectEditableFiles(cwd, writePolicy);
    const evidenceFiles = fs.existsSync(path.join(cwd, "evidence"))
      ? collectFiles(path.join(cwd, "evidence"), cwd)
          .map(file => ({ path: file.path, mtimeMs: fs.statSync(path.join(cwd, file.path)).mtimeMs }))
          .sort((left, right) => right.mtimeMs - left.mtimeMs)
          .map(file => file.path)
          .slice(0, 12)
      : [];
    const threadMemo = buildImplementationMemo(readImplementationThread(cwd), teamConfig.memoHistory);
    const taskOrchestration = {
      ...orchestration,
      taskIndex,
      maxTasksPerIteration: teamConfig.maxTasksPerIteration,
      taskResults: specialistResults,
    };

    console.log(`ShipFlow impl: strategy lead provider=${resolvedProvider}${resolvedModel ? ` model=${resolvedModel}` : ""} (task ${taskIndex}/${teamConfig.maxTasksPerIteration})...`);
    logger.log({
      actorType: "orchestrator",
      actorId: "orchestrator",
      event: "planning.started",
      message: `Orchestrator started planning task ${taskIndex} for iteration ${Number(orchestration.iteration || 1)}.`,
      iteration: orchestration.iteration ?? null,
      stage: "impl",
      data: {
        provider: resolvedProvider,
        model: resolvedModel,
        memo_stagnation_streak: Number(threadMemo.stagnation_streak || 0),
        task_index: taskIndex,
        completed_tasks: specialistResults.map(item => item.task_id || item.role),
      },
    });

    const strategyDecision = teamConfig.enabled
      ? await analyzeImplementationStrategy({
          cwd,
          vpFiles,
          genFiles,
          editableFiles,
          config,
          errors,
          writePolicy,
          provider: resolvedProvider,
          model: resolvedModel,
          maxTokens,
          timeoutMs,
          providerOptions,
          evidenceFiles,
          orchestration: taskOrchestration,
          generateWithProviderImpl,
          logger,
        })
      : fallbackStrategyDecision({
          run: null,
          team: teamConfig,
          verificationTypes: verificationTypesFromVpFiles(vpFiles),
          attemptedRoles: specialistResults.map(item => item.role).filter(Boolean),
        });
    strategyDecisions.push(strategyDecision);
    logger.log({
      actorType: "orchestrator",
      actorId: "orchestrator",
      event: "planning.completed",
      message: strategyDecision.continue_iteration
        ? `Orchestrator selected the next ${strategyDecision.next_task?.role || "specialist"} micro-task.`
        : "Orchestrator stopped the current wave and handed off to verification.",
      iteration: orchestration.iteration ?? null,
      stage: "impl",
      data: {
        approach: strategyDecision.approach || null,
        changed_approach: Boolean(strategyDecision.changed_approach),
        task_index: taskIndex,
        next_task_id: strategyDecision.next_task?.task_id || null,
        next_role: strategyDecision.next_task?.role || null,
        stop_reason: strategyDecision.stop_reason || "",
      },
    });

    if (!strategyDecision.continue_iteration || !strategyDecision.next_task) {
      stopReason = strategyDecision.stop_reason || "Strategy lead requested verification after the current micro-task wave.";
      console.log(`ShipFlow impl: strategy lead stopped the current wave — ${stopReason}`);
      break;
    }

    const assignment = strategyDecision.next_task;
    const basePrompt = buildPrompt(vpFiles, genFiles, editableFiles, config, errors, writePolicy, {
      provider: resolvedProvider,
      evidenceFiles,
      scaffoldState,
    });
    logger.log({
      actorType: "orchestrator",
      actorId: "orchestrator",
      event: "delegation.started",
      message: `Orchestrator delegated the ${assignment.role} micro-task.`,
      iteration: orchestration.iteration ?? null,
      stage: "impl",
      data: {
        task_id: assignment.task_id || null,
        role: assignment.role,
        goal: assignment.goal || "",
        target_groups: assignment.target_groups || [],
      },
    });
    console.log(`ShipFlow impl: ${assignment.role} specialist working...`);
    const result = await requestFilesFromSpecialist({
      assignment,
      basePrompt,
      cwd,
      provider: resolvedProvider,
      model: resolvedModel,
      maxTokens,
      timeoutMs,
      providerOptions,
      generateWithProviderImpl,
      writePolicy,
      orchestration: { ...taskOrchestration, memo: threadMemo },
      logger,
    });
    specialistResults.push(result);
    for (const file of result.written_files) writtenFiles.add(file);
    logger.log({
      actorType: "orchestrator",
      actorId: "orchestrator",
      event: "delegation.completed",
      message: `Orchestrator received the ${assignment.role} specialist result.`,
      iteration: orchestration.iteration ?? null,
      stage: "impl",
      data: {
        task_id: result.task_id || assignment.task_id || null,
        role: assignment.role,
        status: result.status || null,
        goal: result.goal || assignment.goal || "",
        written_files: result.written_files || [],
        handoff_role: result.blocker_report?.handoff_role || null,
      },
    });
    if (result.status === "blocked" && result.blocker_report?.summary) {
      console.log(`ShipFlow impl: ${assignment.role} specialist returned early — ${result.blocker_report.summary}`);
    }
  }

  const written = [...writtenFiles];
  const blockedSpecialists = specialistResults.filter(item => item.status === "blocked");
  if (written.length === 0 && blockedSpecialists.length === 0 && !stopReason) {
    throw new Error("ShipFlow impl: specialist team returned no writable files.");
  }

  if (written.length > 0) {
    console.log(`ShipFlow impl: wrote ${written.length} file(s) → ${written.join(", ")}`);
  } else if (blockedSpecialists.length > 0) {
    console.log("ShipFlow impl: no specialist found a simple safe fix in this round; returning blocker reports to the orchestrator.");
  } else {
    console.log(`ShipFlow impl: specialist wave ended without code changes — ${stopReason}`);
  }
  const strategyPlan = {
    summary: strategyDecisions.at(-1)?.summary || "",
    approach: strategyDecisions.at(-1)?.approach || "",
    changed_approach: strategyDecisions.some(item => Boolean(item?.changed_approach)),
    stop_reason: stopReason,
    root_causes: [...new Set(strategyDecisions.flatMap(item => Array.isArray(item?.root_causes) ? item.root_causes : []))].slice(0, 8),
    tasks: strategyDecisions.flatMap(item => Array.isArray(item?.tasks) ? item.tasks : []).slice(0, teamConfig.maxTasksPerIteration),
  };
  logger.log({
    actorType: "orchestrator",
    actorId: "orchestrator",
    event: "round.completed",
    message: written.length > 0
      ? `Specialist micro-task wave completed with ${written.length} written file(s).`
      : "Specialist micro-task wave completed without new file writes.",
    iteration: orchestration.iteration ?? null,
    stage: "impl",
    data: {
      stop_reason: stopReason,
      task_count: strategyPlan.tasks.length,
      written_files: written,
      blocked_roles: blockedSpecialists.map(item => item.role),
    },
  });
  return {
    written,
    strategyPlan,
    specialists: specialistResults,
  };
}
