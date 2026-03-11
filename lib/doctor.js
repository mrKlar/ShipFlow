import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readConfig } from "./config.js";
import { providerReady, resolveProviderName } from "./providers/index.js";
import { collectVerificationRequirements, hasDependency } from "./verification-requirements.js";
import { runtimeCommandExists, shipflowBinDir } from "./util/runtime-env.js";

function commandExists(cwd, cmd) {
  return runtimeCommandExists(cwd, cmd, spawnSync);
}

function hasKiroCli(exists) {
  return exists("kiro-cli") || exists("kiro");
}

function frameworkReady(cwd, framework) {
  if (framework === "cucumber") return hasDependency(cwd, "@cucumber/cucumber");
  if (framework === "dependency-cruiser") return hasDependency(cwd, "dependency-cruiser");
  if (framework === "madge") return hasDependency(cwd, "madge");
  if (framework === "tsarch") return hasDependency(cwd, "tsarch");
  if (framework === "eslint-plugin-boundaries") return hasDependency(cwd, "eslint-plugin-boundaries") && hasDependency(cwd, "eslint");
  return true;
}

function supportsNodeSqlite() {
  const major = Number.parseInt(String(process.versions.node || "0").split(".")[0], 10);
  return Number.isFinite(major) && major >= 22;
}

export function buildDoctor(cwd, deps = {}) {
  const exists = deps.commandExists || ((cmd) => commandExists(cwd, cmd));
  const env = deps.env || process.env;
  const nodeSqlite = deps.nodeSqliteSupported ?? supportsNodeSqlite();
  const config = readConfig(cwd);
  const requirements = collectVerificationRequirements(cwd);
  const configuredDraftProvider = env.SHIPFLOW_DRAFT_PROVIDER || config.draft?.provider || "local";
  const configuredImplProvider = env.SHIPFLOW_IMPL_PROVIDER || config.impl?.provider || "auto";
  const draftProvider = configuredDraftProvider === "local"
    ? "local"
    : resolveProviderName(configuredDraftProvider, cwd, { commandExists: exists, env });
  const draftAiProvider = resolveProviderName(config.draft?.aiProvider || config.impl?.provider || "auto", cwd, { commandExists: exists, env });
  const implProvider = resolveProviderName(configuredImplProvider, cwd, { commandExists: exists, env });
  const checks = {
    node: exists("node"),
    npm: exists("npm"),
    npx: exists("npx"),
    claude: exists("claude"),
      codex: exists("codex"),
      gemini: exists("gemini"),
      kiro: hasKiroCli(exists),
    playwright_pkg: hasDependency(cwd, "@playwright/test"),
    opa: exists("opa"),
    k6: exists("k6"),
    sqlite3: exists("sqlite3"),
    node_sqlite: nodeSqlite,
    psql: exists("psql"),
    runtime_bin_dir: shipflowBinDir(cwd),
    draft_provider: draftProvider,
    draft_ai_provider: draftAiProvider,
    draft_provider_ready: providerReady(
      draftProvider === "local" ? draftAiProvider : draftProvider,
      { ...config.draft, command: config.draft?.command || config.impl?.command },
      env,
      exists,
    ),
    impl_provider: implProvider,
    impl_provider_ready: providerReady(implProvider, config.impl, env, exists),
    requirements,
  };
  const issues = [];
  if (!checks.node || !checks.npm || !checks.npx) issues.push("Core Node.js tooling is incomplete.");
  if (requirements.playwright_required && !checks.playwright_pkg) {
    issues.push("`@playwright/test` is not declared in package.json.");
  }
  if (!checks.claude && !checks.codex && !checks.gemini && !checks.kiro) issues.push("No supported AI CLI detected.");
  if (!checks.draft_provider_ready) {
    const target = draftProvider === "local" ? draftAiProvider : draftProvider;
    if (target === "anthropic") issues.push("Anthropic draft provider selected but ANTHROPIC_API_KEY is missing.");
    else if (target === "command") issues.push("Command draft provider selected but draft.command.bin is missing or unavailable.");
    else issues.push(`Selected draft provider "${target}" is not ready.`);
  }
  if (!checks.impl_provider_ready) {
    if (implProvider === "anthropic") issues.push("Anthropic provider selected but ANTHROPIC_API_KEY is missing.");
    else if (implProvider === "command") issues.push("Command provider selected but impl.command.bin is missing or unavailable.");
    else issues.push(`Selected impl provider "${implProvider}" is not ready.`);
  }
  if (requirements.k6_required && !checks.k6) {
    issues.push("Performance verifications are present but `k6` is not installed.");
  }
  if (requirements.opa_required && !checks.opa) {
    issues.push("Policy verifications are present but `opa` is not installed.");
  }
  if (requirements.db_engines.includes("sqlite") && !checks.sqlite3 && !checks.node_sqlite) {
    issues.push("SQLite database verifications are present but neither `sqlite3` nor Node's `node:sqlite` runtime is available.");
  }
  if (requirements.db_engines.includes("postgresql") && !checks.psql) {
    issues.push("PostgreSQL database verifications are present but `psql` is not installed.");
  }
  for (const framework of requirements.behavior_frameworks) {
    if (!frameworkReady(cwd, framework)) {
      issues.push(`Behavior verifications require ${framework}, but it is not declared in package.json.`);
    }
  }
  for (const framework of requirements.technical_frameworks) {
    if (!frameworkReady(cwd, framework)) {
      issues.push(`Technical verifications require ${framework}, but it is not declared in package.json.`);
    }
  }
  for (const pkg of requirements.technical_packages) {
    if (!hasDependency(cwd, pkg)) {
      issues.push(`Technical verifications require ${pkg}, but it is not declared in package.json.`);
    }
  }
  for (const pkg of requirements.visual_packages) {
    if (!hasDependency(cwd, pkg)) {
      issues.push(`Visual UI verifications require ${pkg}, but it is not declared in package.json.`);
    }
  }
  for (const issue of requirements.parse_issues) {
    issues.push(issue);
  }

  const normalizedIssues = [...new Set(issues)];
  return {
    ok: normalizedIssues.length === 0,
    checks,
    issues: normalizedIssues,
  };
}

export function doctor({ cwd, json = false }) {
  const result = buildDoctor(cwd);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("ShipFlow Doctor\n");
    for (const [name, value] of Object.entries(result.checks)) {
      if (typeof value === "boolean") {
        console.log(`  ${value ? "OK  " : "MISS"} ${name}`);
      } else {
        console.log(`  INFO ${name}: ${value}`);
      }
    }
    if (result.issues.length > 0) {
      console.log("");
      for (const issue of result.issues) console.log(`  - ${issue}`);
    }
  }
  return { exitCode: result.ok ? 0 : 1, result };
}
