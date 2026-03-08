import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readConfig } from "./config.js";
import { providerReady, resolveProviderName } from "./providers/index.js";

function commandExists(cmd) {
  const res = spawnSync("bash", ["-lc", `command -v ${cmd}`], { stdio: "pipe" });
  return res.status === 0;
}

function hasKiroCli(exists) {
  return exists("kiro-cli") || exists("kiro");
}

function hasDependency(cwd, name) {
  const file = path.join(cwd, "package.json");
  if (!fs.existsSync(file)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf-8"));
    return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
      .some(section => pkg[section] && Object.prototype.hasOwnProperty.call(pkg[section], name));
  } catch {
    return false;
  }
}

export function buildDoctor(cwd, deps = {}) {
  const exists = deps.commandExists || commandExists;
  const env = deps.env || process.env;
  const config = readConfig(cwd);
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
  };
  const issues = [];
  if (!checks.node || !checks.npm || !checks.npx) issues.push("Core Node.js tooling is incomplete.");
  if (!checks.playwright_pkg) issues.push("`@playwright/test` is not declared in package.json.");
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

  return {
    ok: issues.length === 0,
    checks,
    issues,
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
