import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MOVIE_COMMENTS_LIVE_REQUIRED_VP_PATHS = [
  "vp/ui/post-movie-comment.yml",
  "vp/ui/show-persisted-comment.yml",
  "vp/behavior/query-movie-comments.yml",
  "vp/behavior/persist-movie-comments-after-restart.yml",
  "vp/domain/movie.yml",
  "vp/api/add-movie-comment.yml",
  "vp/api/get-movie-detail.yml",
  "vp/db/movie-comments.yml",
  "vp/technical/framework-stack.yml",
  "vp/technical/api-protocol.yml",
  "vp/technical/sqlite-runtime.yml",
];

export const MOVIE_COMMENTS_LIVE_PROVIDER_ORDER = ["claude", "codex", "gemini", "kiro"];

const MOVIE_COMMENTS_LIVE_PROVIDER_COMMANDS = {
  claude: ["claude"],
  codex: ["codex"],
  gemini: ["gemini"],
  kiro: ["kiro-cli", "kiro"],
};

export const movieCommentsLiveExampleDir = path.resolve(__dirname, "../../examples/movie-comments-app");
export const movieCommentsLiveRunnerPath = path.join(movieCommentsLiveExampleDir, "run-live.mjs");

export function commandExists(cmd) {
  const result = spawnSync("bash", ["-lc", `command -v ${cmd}`], { stdio: "pipe" });
  return result.status === 0;
}

export function normalizeMovieCommentsLiveProviders(input) {
  const raw = Array.isArray(input) ? input : String(input || "").split(",");
  const seen = new Set();
  const providers = [];
  for (const entry of raw) {
    const provider = String(entry || "").trim().toLowerCase();
    if (!provider || seen.has(provider)) continue;
    if (!Object.hasOwn(MOVIE_COMMENTS_LIVE_PROVIDER_COMMANDS, provider)) {
      throw new Error(`Unsupported movie-comments live provider: ${provider}`);
    }
    seen.add(provider);
    providers.push(provider);
  }
  return providers;
}

export function movieCommentsLiveProviderCommand(provider, exists = commandExists) {
  const candidates = MOVIE_COMMENTS_LIVE_PROVIDER_COMMANDS[provider] || [];
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function resolveMovieCommentsLiveProviders({ env = process.env, exists = commandExists } = {}) {
  const requested = normalizeMovieCommentsLiveProviders(
    env.SHIPFLOW_LIVE_MOVIE_COMMENTS_PROVIDERS || env.SHIPFLOW_LIVE_PROVIDERS || MOVIE_COMMENTS_LIVE_PROVIDER_ORDER,
  );
  return requested.filter(provider => movieCommentsLiveProviderCommand(provider, exists));
}

export function buildMovieCommentsLiveArgs(provider, env = process.env) {
  const args = [movieCommentsLiveRunnerPath, `--provider=${provider}`];
  if (env.SHIPFLOW_LIVE_KEEP === "1") args.push("--keep");
  if (env.SHIPFLOW_LIVE_MODEL) args.push(`--model=${env.SHIPFLOW_LIVE_MODEL}`);
  return args;
}

export function buildMovieCommentsLiveEnv(env = process.env, nodeExecPath = process.execPath) {
  const nextEnv = {
    ...env,
    PATH: [path.dirname(nodeExecPath), env.PATH || ""].filter(Boolean).join(path.delimiter),
  };
  const maxIterations = String(env.SHIPFLOW_LIVE_MAX_ITERATIONS || "").trim();
  if (maxIterations) nextEnv.SHIPFLOW_LIVE_MAX_ITERATIONS = maxIterations;
  else delete nextEnv.SHIPFLOW_LIVE_MAX_ITERATIONS;
  return nextEnv;
}

export function movieCommentsLiveBaseUrl(port) {
  return `http://127.0.0.1:${Number(port)}`;
}

export function withMovieCommentsLivePortInDevScript(script, port) {
  const normalized = String(script || "node src/server.js").trim();
  if (/(^|\s)PORT=/.test(normalized)) return normalized;
  return `PORT=${Number(port)} ${normalized}`;
}

export function rewriteMovieCommentsBaseUrls(source, portOrBaseUrl) {
  const baseUrl = String(portOrBaseUrl).startsWith("http")
    ? String(portOrBaseUrl)
    : movieCommentsLiveBaseUrl(portOrBaseUrl);
  return String(source || "").replace(/http:\/\/(?:localhost|127\.0\.0\.1):3000/g, baseUrl);
}
