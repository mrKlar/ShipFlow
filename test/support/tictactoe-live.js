import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TICTACTOE_LIVE_REQUIRED_VP_PATHS = [
  "vp/ui/play-winning-game.yml",
  "vp/ui/show-score-history.yml",
  "vp/behavior/query-score-history.yml",
  "vp/behavior/persist-score-history-after-restart.yml",
  "vp/domain/completed-game.yml",
  "vp/api/record-completed-game.yml",
  "vp/api/get-score-history.yml",
  "vp/db/score-history.yml",
  "vp/technical/framework-stack.yml",
  "vp/technical/api-protocol.yml",
  "vp/technical/sqlite-runtime.yml",
];

export const TICTACTOE_LIVE_PROVIDER_ORDER = ["claude", "codex", "gemini", "kiro"];

const TICTACTOE_LIVE_PROVIDER_COMMANDS = {
  claude: ["claude"],
  codex: ["codex"],
  gemini: ["gemini"],
  kiro: ["kiro-cli", "kiro"],
};

export const tictactoeLiveExampleDir = path.resolve(__dirname, "../../examples/tic-tac-toe-app");
export const tictactoeLiveRunnerPath = path.join(tictactoeLiveExampleDir, "run-live.mjs");

export function commandExists(cmd) {
  const result = spawnSync("bash", ["-lc", `command -v ${cmd}`], { stdio: "pipe" });
  return result.status === 0;
}

export function normalizeTictactoeLiveProviders(input) {
  const raw = Array.isArray(input) ? input : String(input || "").split(",");
  const seen = new Set();
  const providers = [];
  for (const entry of raw) {
    const provider = String(entry || "").trim().toLowerCase();
    if (!provider || seen.has(provider)) continue;
    if (!Object.hasOwn(TICTACTOE_LIVE_PROVIDER_COMMANDS, provider)) {
      throw new Error(`Unsupported tic-tac-toe live provider: ${provider}`);
    }
    seen.add(provider);
    providers.push(provider);
  }
  return providers;
}

export function tictactoeLiveProviderCommand(provider, exists = commandExists) {
  const candidates = TICTACTOE_LIVE_PROVIDER_COMMANDS[provider] || [];
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function resolveTictactoeLiveProviders({ env = process.env, exists = commandExists } = {}) {
  const requested = normalizeTictactoeLiveProviders(
    env.SHIPFLOW_LIVE_TICTACTOE_PROVIDERS || env.SHIPFLOW_LIVE_PROVIDERS || TICTACTOE_LIVE_PROVIDER_ORDER,
  );
  return requested.filter(provider => tictactoeLiveProviderCommand(provider, exists));
}

export function buildTictactoeLiveArgs(provider, env = process.env) {
  const args = [tictactoeLiveRunnerPath, `--provider=${provider}`];
  if (env.SHIPFLOW_LIVE_KEEP === "1") args.push("--keep");
  if (env.SHIPFLOW_LIVE_MODEL) args.push(`--model=${env.SHIPFLOW_LIVE_MODEL}`);
  return args;
}

export function buildTictactoeLiveEnv(env = process.env, nodeExecPath = process.execPath) {
  const nextEnv = {
    ...env,
    PATH: [path.dirname(nodeExecPath), env.PATH || ""].filter(Boolean).join(path.delimiter),
  };
  const maxIterations = String(env.SHIPFLOW_LIVE_MAX_ITERATIONS || "").trim();
  if (maxIterations) nextEnv.SHIPFLOW_LIVE_MAX_ITERATIONS = maxIterations;
  else delete nextEnv.SHIPFLOW_LIVE_MAX_ITERATIONS;
  return nextEnv;
}

export function tictactoeLiveBaseUrl(port) {
  return `http://127.0.0.1:${Number(port)}`;
}

export function withTictactoeLivePortInDevScript(script, port) {
  const normalized = String(script || "node src/server.js").trim();
  if (/(^|\s)PORT=/.test(normalized)) return normalized;
  return `PORT=${Number(port)} ${normalized}`;
}

export function rewriteTicTacToeBaseUrls(source, portOrBaseUrl) {
  const baseUrl = String(portOrBaseUrl).startsWith("http")
    ? String(portOrBaseUrl)
    : tictactoeLiveBaseUrl(portOrBaseUrl);
  return String(source || "").replace(/http:\/\/(?:localhost|127\.0\.0\.1):3000/g, baseUrl);
}
