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

function generateWithCommand({ prompt, command }) {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    throw new Error(
      "Command provider requires impl.command.bin and optional impl.command.args in shipflow.json."
    );
  }

  const result = spawnSync(normalized.bin, normalized.args, {
    input: normalized.prompt_stdin ? prompt : undefined,
    encoding: "utf-8",
    stdio: "pipe",
    env: { ...process.env, ...normalized.env },
  });

  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    throw new Error(`Command provider failed (${normalized.bin} ${normalized.args.join(" ")}):\n${output}`);
  }

  const text = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (!text) throw new Error("Command provider returned no text.");
  return text;
}

export function defaultModelForProvider(provider) {
  if (provider === "anthropic") return "claude-sonnet-4-6";
  return "";
}

export async function generateWithProvider({ provider, model, maxTokens, prompt, options = {} }) {
  if (provider === "anthropic") {
    return generateWithAnthropic({ model, maxTokens, prompt });
  }
  if (provider === "command") {
    return generateWithCommand({ prompt, command: options.command });
  }
  throw new Error(`Unsupported ShipFlow provider: ${provider}`);
}
