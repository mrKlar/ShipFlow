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

export function runtimeActivateScriptPath(cwd) {
  return path.join(shipflowRuntimeRoot(cwd), "activate.sh");
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

export function resolveRuntimeCommandPath(cwd, cmd, spawn = spawnSync, env = process.env) {
  if (!cmd) return null;
  const local = shipflowExecutablePath(cwd, cmd);
  if (local) return local;
  const result = spawn("bash", ["-lc", `command -v ${cmd}`], {
    stdio: "pipe",
    encoding: "utf-8",
    env: buildRuntimeEnv(cwd, env),
  });
  if (result.status !== 0) return null;
  const resolved = String(result.stdout || "").trim().split(/\r?\n/).find(Boolean);
  return resolved || null;
}

export function writeRuntimeCommandShim(cwd, name, targetPath) {
  if (!name || !targetPath) return null;
  const dirs = ensureRuntimeDirs(cwd);
  const destination = path.join(dirs.bin, process.platform === "win32" ? `${name}.cmd` : name);
  const normalizedTarget = String(targetPath).replace(/"/g, '\\"');
  const content = process.platform === "win32"
    ? `@echo off\r\n"${normalizedTarget}" %*\r\n`
    : `#!/usr/bin/env bash\nexec "${normalizedTarget}" "$@"\n`;
  fs.writeFileSync(destination, content);
  if (process.platform !== "win32") fs.chmodSync(destination, 0o755);
  return destination;
}

export function writeRuntimeActivateScript(cwd) {
  const dirs = ensureRuntimeDirs(cwd);
  const file = runtimeActivateScriptPath(cwd);
  const content = [
    "#!/usr/bin/env bash",
    'SHIPFLOW_RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'export PATH="$SHIPFLOW_RUNTIME_DIR/bin${PATH:+:$PATH}"',
    'export npm_config_cache="${npm_config_cache:-$SHIPFLOW_RUNTIME_DIR/npm-cache}"',
    'export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$SHIPFLOW_RUNTIME_DIR/playwright}"',
    "",
  ].join("\n");
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
  return file;
}
