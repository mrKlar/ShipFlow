import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function shipflowRuntimeRoot(cwd) {
  return path.join(cwd, ".shipflow", "runtime");
}

export function shipflowBinDir(cwd) {
  return path.join(shipflowRuntimeRoot(cwd), "bin");
}

export function shipflowNpmCacheDir(cwd) {
  return path.join(shipflowRuntimeRoot(cwd), "npm-cache");
}

export function shipflowPlaywrightDir(cwd) {
  return path.join(shipflowRuntimeRoot(cwd), "playwright");
}

export function ensureRuntimeDirs(cwd) {
  const root = shipflowRuntimeRoot(cwd);
  const bin = shipflowBinDir(cwd);
  const npmCache = shipflowNpmCacheDir(cwd);
  const playwright = shipflowPlaywrightDir(cwd);
  mkdirp(root);
  mkdirp(bin);
  mkdirp(npmCache);
  mkdirp(playwright);
  return { root, bin, npmCache, playwright };
}

export function shipflowExecutablePath(cwd, command) {
  if (!command) return null;
  const base = path.join(shipflowBinDir(cwd), process.platform === "win32" ? `${command}.exe` : command);
  return fs.existsSync(base) ? base : null;
}

export function buildRuntimeEnv(cwd, baseEnv = process.env, extraEnv = {}) {
  const dirs = ensureRuntimeDirs(cwd);
  const currentPath = String(extraEnv.PATH || baseEnv.PATH || "");
  return {
    ...baseEnv,
    ...extraEnv,
    PATH: [dirs.bin, currentPath].filter(Boolean).join(path.delimiter),
    npm_config_cache: extraEnv.npm_config_cache || dirs.npmCache,
    PLAYWRIGHT_BROWSERS_PATH: extraEnv.PLAYWRIGHT_BROWSERS_PATH || dirs.playwright,
  };
}

export function runtimeCommandExists(cwd, cmd, spawn = spawnSync, env = process.env) {
  if (shipflowExecutablePath(cwd, cmd)) return true;
  const result = spawn("bash", ["-lc", `command -v ${cmd}`], {
    stdio: "pipe",
    env: buildRuntimeEnv(cwd, env),
  });
  return result.status === 0;
}
