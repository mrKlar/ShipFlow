import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TODO_LIVE_MINIMAL_VP_PATHS = [
  "vp/ui/filter-todos.yml",
  "vp/behavior/get-api-todos-flow.yml",
  "vp/behavior/persist-todos-after-restart.yml",
  "vp/api/get-todos.yml",
  "vp/api/post-todos.yml",
  "vp/api/patch-todo-completed.yml",
  "vp/db/todos-state.yml",
  "vp/technical/framework-stack.yml",
  "vp/technical/api-protocol.yml",
  "vp/technical/sqlite-runtime.yml",
];

export const TODO_LIVE_PROVIDER_ORDER = ["claude", "codex", "gemini", "kiro"];

const TODO_LIVE_PROVIDER_COMMANDS = {
  claude: ["claude"],
  codex: ["codex"],
  gemini: ["gemini"],
  kiro: ["kiro-cli", "kiro"],
};

export const todoLiveExampleDir = path.resolve(__dirname, "../../examples/todo-app");
export const todoLiveRunnerPath = path.join(todoLiveExampleDir, "run-live.mjs");

export function commandExists(cmd) {
  const result = spawnSync("bash", ["-lc", `command -v ${cmd}`], { stdio: "pipe" });
  return result.status === 0;
}

export function normalizeTodoLiveProviders(input) {
  const raw = Array.isArray(input) ? input : String(input || "").split(",");
  const seen = new Set();
  const providers = [];
  for (const entry of raw) {
    const provider = String(entry || "").trim().toLowerCase();
    if (!provider || seen.has(provider)) continue;
    if (!Object.hasOwn(TODO_LIVE_PROVIDER_COMMANDS, provider)) {
      throw new Error(`Unsupported todo live provider: ${provider}`);
    }
    seen.add(provider);
    providers.push(provider);
  }
  return providers;
}

export function todoLiveProviderCommand(provider, exists = commandExists) {
  const candidates = TODO_LIVE_PROVIDER_COMMANDS[provider] || [];
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function resolveTodoLiveProviders({ env = process.env, exists = commandExists } = {}) {
  const requested = normalizeTodoLiveProviders(
    env.SHIPFLOW_LIVE_TODO_PROVIDERS || env.SHIPFLOW_LIVE_PROVIDERS || TODO_LIVE_PROVIDER_ORDER
  );
  return requested.filter(provider => todoLiveProviderCommand(provider, exists));
}

export function buildTodoLiveArgs(provider, env = process.env) {
  const args = [todoLiveRunnerPath, `--provider=${provider}`];
  if (env.SHIPFLOW_LIVE_KEEP === "1") args.push("--keep");
  if (env.SHIPFLOW_LIVE_AI_DRAFT === "1") args.push("--ai-draft");
  if (env.SHIPFLOW_LIVE_MODEL) args.push(`--model=${env.SHIPFLOW_LIVE_MODEL}`);
  return args;
}

export function buildTodoLiveEnv(env = process.env, nodeExecPath = process.execPath) {
  const nextEnv = {
    ...env,
    PATH: [path.dirname(nodeExecPath), env.PATH || ""].filter(Boolean).join(path.delimiter),
  };
  const maxIterations = String(env.SHIPFLOW_LIVE_MAX_ITERATIONS || "").trim();
  if (maxIterations) nextEnv.SHIPFLOW_LIVE_MAX_ITERATIONS = maxIterations;
  else delete nextEnv.SHIPFLOW_LIVE_MAX_ITERATIONS;
  return nextEnv;
}

export function todoLiveBaseUrl(port) {
  return `http://127.0.0.1:${Number(port)}`;
}

export function withTodoLivePortInDevScript(script, port) {
  const normalized = String(script || "node src/server.js").trim();
  if (/(^|\s)PORT=/.test(normalized)) return normalized;
  return `PORT=${Number(port)} ${normalized}`;
}

export function rewriteTodoLiveBaseUrls(source, portOrBaseUrl) {
  const baseUrl = String(portOrBaseUrl).startsWith("http")
    ? String(portOrBaseUrl)
    : todoLiveBaseUrl(portOrBaseUrl);
  return String(source || "").replace(/http:\/\/(?:localhost|127\.0\.0\.1):3000/g, baseUrl);
}
