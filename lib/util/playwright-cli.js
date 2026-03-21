import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { resolveRuntimeCommandPath } from "./runtime-env.js";

const PLAYWRIGHT_MIN_NODE_MAJOR = 18;
const PLAYWRIGHT_MAX_NODE_MAJOR = 22;

function parseNodeVersion(raw) {
  const match = String(raw || "").trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2] || "0", 10),
    patch: Number.parseInt(match[3] || "0", 10),
    raw: `v${match[1]}.${match[2] || "0"}.${match[3] || "0"}`,
  };
}

function compareNodeVersionsDescending(left, right) {
  return right.major - left.major || right.minor - left.minor || right.patch - left.patch;
}

function executableName(base) {
  return process.platform === "win32" ? `${base}.exe` : base;
}

function addCandidate(list, seen, candidatePath) {
  if (!candidatePath || !fs.existsSync(candidatePath)) return;
  const normalized = path.resolve(candidatePath);
  if (seen.has(normalized)) return;
  seen.add(normalized);
  list.push(candidatePath);
}

function nvmNodeCandidates(env = process.env) {
  const roots = [env.NVM_DIR, env.HOME ? path.join(env.HOME, ".nvm") : null].filter(Boolean);
  const results = [];
  const seen = new Set();
  for (const root of roots) {
    const versionsDir = path.join(root, "versions", "node");
    if (!fs.existsSync(versionsDir)) continue;
    for (const entry of fs.readdirSync(versionsDir)) {
      const nodePath = path.join(versionsDir, entry, "bin", executableName("node"));
      addCandidate(results, seen, nodePath);
    }
  }
  return results;
}

function readNodeVersion(nodePath, spawn = spawnSync, env = process.env) {
  const result = spawn(nodePath, ["-v"], {
    stdio: "pipe",
    encoding: "utf-8",
    env,
  });
  if (result.status !== 0) return null;
  const version = parseNodeVersion(result.stdout || result.stderr || "");
  if (!version) return null;
  return {
    path: nodePath,
    ...version,
  };
}

export function resolvePlaywrightCliPath(cwd) {
  try {
    const requireFromCwd = createRequire(path.join(cwd, "__shipflow_playwright__.cjs"));
    for (const request of ["playwright/cli.js", "@playwright/test/cli"]) {
      try {
        return requireFromCwd.resolve(request);
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function resolveCompatiblePlaywrightNode(cwd, options = {}) {
  const spawn = options.spawnSync || spawnSync;
  const env = options.env || process.env;
  const currentNode = resolveRuntimeCommandPath(cwd, "node", spawn, env);
  const candidates = [];
  const seen = new Set();
  addCandidate(candidates, seen, currentNode);
  addCandidate(candidates, seen, process.execPath);
  addCandidate(candidates, seen, path.join("/usr", "bin", executableName("node")));
  addCandidate(candidates, seen, path.join("/bin", executableName("node")));
  for (const nodePath of nvmNodeCandidates(env)) addCandidate(candidates, seen, nodePath);

  const resolved = candidates
    .map(nodePath => readNodeVersion(nodePath, spawn, env))
    .filter(Boolean);
  if (resolved.length === 0) return null;

  const current = currentNode
    ? resolved.find(candidate => path.resolve(candidate.path) === path.resolve(currentNode))
    : null;
  if (current && current.major >= PLAYWRIGHT_MIN_NODE_MAJOR && current.major <= PLAYWRIGHT_MAX_NODE_MAJOR) {
    return current;
  }

  const compatible = resolved
    .filter(candidate => candidate.major >= PLAYWRIGHT_MIN_NODE_MAJOR && candidate.major <= PLAYWRIGHT_MAX_NODE_MAJOR)
    .sort(compareNodeVersionsDescending)[0];
  return compatible || current || resolved.sort(compareNodeVersionsDescending)[0];
}

export function runPlaywrightCommand(cwd, args, options = {}) {
  const spawn = options.spawnSync || spawnSync;
  const env = options.env || process.env;
  const cliPath = options.cliPath || resolvePlaywrightCliPath(cwd);
  const node = options.nodePath || resolveCompatiblePlaywrightNode(cwd, { spawnSync: spawn, env })?.path;
  const spawnOptions = {
    cwd,
    env,
    stdio: options.stdio || "pipe",
  };
  if (options.encoding) spawnOptions.encoding = options.encoding;

  if (cliPath && node) {
    return spawn(node, [cliPath, ...args], spawnOptions);
  }

  return spawn("npx", ["playwright", ...args], spawnOptions);
}
