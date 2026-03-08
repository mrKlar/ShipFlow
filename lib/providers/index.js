import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateWithAnthropic } from "./anthropic.js";

function normalizeCommand(definition) {
  if (!definition || typeof definition !== "object") return null;
  if (typeof definition.bin !== "string" || definition.bin.length === 0) return null;
  return {
    bin: definition.bin,
    args: Array.isArray(definition.args) ? definition.args.map(String) : [],
    env: definition.env && typeof definition.env === "object" ? definition.env : {},
    prompt_stdin: definition.prompt_stdin !== false,
  };
}

function commandExists(cmd) {
  const result = spawnSync("bash", ["-lc", `command -v ${cmd}`], { stdio: "pipe" });
  return result.status === 0;
}

function hasProjectFile(cwd, relPath) {
  return fs.existsSync(path.join(cwd, relPath));
}

export function resolveAutoProvider(cwd, deps = {}) {
  const exists = deps.commandExists || commandExists;
  const env = deps.env || process.env;

  if (env.SHIPFLOW_ACTIVE_PROVIDER) return String(env.SHIPFLOW_ACTIVE_PROVIDER);
  if ((env.CODEX_THREAD_ID || env.CODEX_CI || env.CODEX_MANAGED_BY_NPM) && exists("codex")) return "codex";
  if ((env.CLAUDECODE || env.CLAUDE_CODE || env.CLAUDE_SESSION_ID) && exists("claude")) return "claude";
  if ((env.GEMINI_CLI || env.GEMINI_CLI_SESSION_ID) && exists("gemini")) return "gemini";

  const preferred = [
    {
      provider: "claude",
      configured: hasProjectFile(cwd, "CLAUDE.md") || hasProjectFile(cwd, ".claude/hooks.json"),
    },
    {
      provider: "codex",
      configured: hasProjectFile(cwd, "AGENTS.md") || hasProjectFile(cwd, ".codex/config.toml"),
    },
    {
      provider: "gemini",
      configured: hasProjectFile(cwd, "GEMINI.md") || hasProjectFile(cwd, ".gemini/settings.json"),
    },
  ];

  for (const item of preferred) {
    if (item.configured && exists(item.provider)) return item.provider;
  }
  if (exists("claude")) return "claude";
  if (exists("codex")) return "codex";
  if (exists("gemini")) return "gemini";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return "anthropic";
}

export function resolveProviderName(provider, cwd, deps = {}) {
  if (!provider || provider === "auto") return resolveAutoProvider(cwd, deps);
  return provider;
}

export function resolveProviderModel(section, provider, overrides = {}) {
  const explicitModel = overrides.model;
  if (explicitModel) return explicitModel;

  const envModel = overrides.envModel;
  if (envModel) return envModel;

  if (section?.model) return section.model;
  if (section?.models && typeof section.models === "object") {
    const providerModel = section.models[provider] ?? section.models.default;
    if (providerModel) return providerModel;
  }
  if (overrides.legacyModel) return overrides.legacyModel;
  return defaultModelForProvider(provider);
}

function runCommand({ bin, args, prompt, cwd, env }) {
  const result = spawnSync(bin, args, {
    input: prompt,
    encoding: "utf-8",
    stdio: "pipe",
    cwd,
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result;
}

function extractCommandOutput(result) {
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function generateWithCommand({ prompt, command, cwd }) {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    throw new Error(
      "Command provider requires impl.command.bin and optional impl.command.args in shipflow.json."
    );
  }

  const result = runCommand({
    bin: normalized.bin,
    args: normalized.args,
    prompt: normalized.prompt_stdin ? prompt : undefined,
    cwd,
    env: normalized.env,
  });
  if ((result.status ?? 1) !== 0) {
    const output = extractCommandOutput(result);
    throw new Error(`Command provider failed (${normalized.bin} ${normalized.args.join(" ")}):\n${output}`);
  }

  const text = extractCommandOutput(result);
  if (!text) throw new Error("Command provider returned no text.");
  return text;
}

export function defaultModelForProvider(provider) {
  if (provider === "anthropic") return "claude-sonnet-4-6";
  if (provider === "claude") return "sonnet";
  if (provider === "codex") return "gpt-5-codex";
  if (provider === "gemini") return "gemini-2.5-pro";
  return "";
}

function generateWithCodexCli({ prompt, model, cwd }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-codex-"));
  const outFile = path.join(tmpDir, "last-message.txt");
  try {
    const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-C", cwd, "--output-last-message", outFile];
    if (model) args.push("--model", model);
    args.push("-");
    const result = runCommand({ bin: "codex", args, prompt, cwd });
    if ((result.status ?? 1) !== 0) {
      throw new Error(`Codex provider failed:\n${extractCommandOutput(result)}`);
    }
    const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf-8").trim() : extractCommandOutput(result);
    if (!text) throw new Error("Codex provider returned no text.");
    return text;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function generateWithGeminiCli({ prompt, model, cwd }) {
  const args = ["--prompt", "", "--approval-mode", "plan", "--output-format", "text"];
  if (model) args.push("--model", model);
  const result = runCommand({ bin: "gemini", args, prompt, cwd });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Gemini provider failed:\n${extractCommandOutput(result)}`);
  }
  const text = `${result.stdout || ""}`.trim();
  if (!text) throw new Error("Gemini provider returned no text.");
  return text;
}

function generateWithClaudeCli({ prompt, model, cwd }) {
  const args = ["-p", "--permission-mode", "plan", "--output-format", "text", "--tools", ""];
  if (model) args.push("--model", model);
  args.push(prompt);
  const result = runCommand({ bin: "claude", args, cwd });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Claude provider failed:\n${extractCommandOutput(result)}`);
  }
  const text = `${result.stdout || ""}`.trim();
  if (!text) throw new Error("Claude provider returned no text.");
  return text;
}

export function providerReady(provider, config, env, exists = commandExists) {
  const resolved = provider || "anthropic";
  if (resolved === "local") return true;
  if (resolved === "anthropic") return !!env.ANTHROPIC_API_KEY;
  if (resolved === "claude" || resolved === "codex" || resolved === "gemini") return exists(resolved);
  if (resolved === "command") return !!config?.command?.bin && exists(config.command.bin);
  return false;
}

export async function generateWithProvider({ provider, model, maxTokens, prompt, cwd, options = {} }) {
  if (provider === "anthropic") {
    return generateWithAnthropic({ model, maxTokens, prompt });
  }
  if (provider === "claude") {
    return generateWithClaudeCli({ prompt, model, cwd });
  }
  if (provider === "codex") {
    return generateWithCodexCli({ prompt, model, cwd });
  }
  if (provider === "gemini") {
    return generateWithGeminiCli({ prompt, model, cwd });
  }
  if (provider === "command") {
    return generateWithCommand({ prompt, command: options.command, cwd });
  }
  throw new Error(`Unsupported ShipFlow provider: ${provider}`);
}
