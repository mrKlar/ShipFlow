import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readConfig } from "./config.js";
import { sha256 } from "./util/hash.js";
import {
  buildRuntimeEnv,
  ensureRuntimeDirs,
  resolveRuntimeCommandPath,
  runtimeCommandExists,
  shipflowBinDir,
  shipflowExecutablePath,
  shipflowPlaywrightDir,
  writeRuntimeActivateScript,
  writeRuntimeCommandShim,
} from "./util/runtime-env.js";
import {
  collectVerificationRequirements,
  hasDependency,
  requiredVerificationPackages,
} from "./verification-requirements.js";

const SUPPORTED_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];

function commandExists(cmd, spawn = spawnSync) {
  const res = spawn("bash", ["-lc", `command -v ${cmd}`], { stdio: "pipe" });
  return res.status === 0;
}

function packageJsonPath(cwd) {
  return path.join(cwd, "package.json");
}

function readPackageJson(cwd) {
  const file = packageJsonPath(cwd);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function sanitizePackageName(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "shipflow-app";
}

function ensurePackageJson(cwd) {
  const file = packageJsonPath(cwd);
  if (fs.existsSync(file)) {
    try {
      JSON.parse(fs.readFileSync(file, "utf-8"));
      return { ok: true, created: false, file };
    } catch (error) {
      return {
        ok: false,
        created: false,
        file,
        issue: `package.json is invalid JSON and cannot be bootstrapped automatically: ${error.message}`,
      };
    }
  }

  const pkg = {
    name: sanitizePackageName(path.basename(cwd)),
    private: true,
  };
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  return { ok: true, created: true, file };
}

function packageInstalled(cwd, name) {
  try {
    const requireFromCwd = createRequire(path.join(cwd, "__shipflow_bootstrap__.cjs"));
    requireFromCwd.resolve(name);
    return true;
  } catch {
    return false;
  }
}

export function detectPackageManager(cwd) {
  try {
    const pkg = readPackageJson(cwd);
    const declared = typeof pkg?.packageManager === "string" ? pkg.packageManager.split("@")[0] : null;
    if (declared && SUPPORTED_PACKAGE_MANAGERS.has(declared)) return declared;
  } catch {
    // The caller will report invalid package.json separately when it needs to write.
  }

  if (fs.existsSync(path.join(cwd, "bun.lock")) || fs.existsSync(path.join(cwd, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}

function installCommand(packageManager, packages) {
  if (packageManager === "pnpm") return { bin: "pnpm", args: ["add", "--save-dev", ...packages] };
  if (packageManager === "yarn") return { bin: "yarn", args: ["add", "--dev", ...packages] };
  if (packageManager === "bun") return { bin: "bun", args: ["add", "--dev", ...packages] };
  return { bin: "npm", args: ["install", "--save-dev", ...packages] };
}

function syncCommand(packageManager) {
  if (packageManager === "pnpm") return { bin: "pnpm", args: ["install"] };
  if (packageManager === "yarn") return { bin: "yarn", args: ["install"] };
  if (packageManager === "bun") return { bin: "bun", args: ["install"] };
  return { bin: "npm", args: ["install"] };
}

function runCommand(cwd, bin, args, spawn = spawnSync) {
  return spawn(bin, args, {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
    env: buildRuntimeEnv(cwd),
  });
}

function stdoutOrStderr(result) {
  return String(result.stderr || result.stdout || "").trim();
}

function normalizeRelative(cwd, targetPath) {
  return path.relative(cwd, targetPath).replaceAll("\\", "/");
}

function ensureLocalToolchain(cwd, packageManager, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const env = deps.env || process.env;
  const actions = [];
  const commands = [...new Set(["node", "npm", "npx", packageManager].filter(Boolean))];

  for (const command of commands) {
    const local = shipflowExecutablePath(cwd, command);
    if (local) continue;
    const resolved = resolveRuntimeCommandPath(cwd, command, spawn, env);
    if (!resolved || resolved.startsWith(shipflowBinDir(cwd))) continue;
    const shim = writeRuntimeCommandShim(cwd, command, resolved);
    if (shim) actions.push(`Exposed local ${command} shim in ${normalizeRelative(cwd, shim)}.`);
  }

  const activateFile = path.join(ensureRuntimeDirs(cwd).root, "activate.sh");
  const previousActivate = fs.existsSync(activateFile) ? fs.readFileSync(activateFile, "utf-8") : null;
  const activate = writeRuntimeActivateScript(cwd);
  const currentActivate = fs.readFileSync(activate, "utf-8");
  if (currentActivate !== previousActivate) {
    actions.push(`Wrote ${normalizeRelative(cwd, activate)} to reuse the local runtime toolchain.`);
  }
  return actions;
}

export function dependencyFingerprint(cwd) {
  const files = ["package.json", ...LOCKFILES]
    .map(rel => path.join(cwd, rel))
    .filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
  if (files.length === 0) return null;
  const items = files.map(file => ({
    path: path.relative(cwd, file).replaceAll("\\", "/"),
    sha256: sha256(fs.readFileSync(file)),
  }));
  return sha256(Buffer.from(JSON.stringify(items)));
}

function recursiveFindExecutable(rootDir, names) {
  if (!fs.existsSync(rootDir)) return null;
  const targetNames = new Set(names);
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const found = recursiveFindExecutable(full, names);
      if (found) return found;
      continue;
    }
    if (targetNames.has(entry.name)) return full;
  }
  return null;
}

function platformTokens(platform = process.platform) {
  if (platform === "linux") return ["linux"];
  if (platform === "darwin") return ["macos", "darwin"];
  return [];
}

function archTokens(arch = process.arch) {
  if (arch === "x64") return ["amd64", "x86_64"];
  if (arch === "arm64") return ["arm64", "aarch64"];
  return [];
}

function pickReleaseAsset(assets, tool, platform = process.platform, arch = process.arch) {
  const platformHints = platformTokens(platform);
  const archHints = archTokens(arch);
  if (platformHints.length === 0 || archHints.length === 0) return null;

  return assets.find((asset) => {
    const name = String(asset?.name || "").toLowerCase();
    if (!name.includes(tool)) return false;
    if (!platformHints.some(token => name.includes(token))) return false;
    if (!archHints.some(token => name.includes(token))) return false;
    return name.endsWith(".tar.gz") || name.endsWith(".zip");
  }) || null;
}

function curlJson(url, cwd, spawn) {
  const result = spawn("curl", ["-fsSL", url], {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
    env: buildRuntimeEnv(cwd),
  });
  if (result.status !== 0) {
    throw new Error(stdoutOrStderr(result) || `curl failed for ${url}`);
  }
  return JSON.parse(String(result.stdout || "{}"));
}

function downloadFile(url, destination, cwd, spawn) {
  const result = spawn("curl", ["-fsSL", url, "-o", destination], {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
    env: buildRuntimeEnv(cwd),
  });
  if (result.status !== 0) {
    throw new Error(stdoutOrStderr(result) || `download failed for ${url}`);
  }
}

function extractArchive(archive, destination, cwd, spawn) {
  if (archive.endsWith(".tar.gz")) {
    const result = spawn("tar", ["-xzf", archive, "-C", destination], {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
      env: buildRuntimeEnv(cwd),
    });
    if (result.status !== 0) throw new Error(stdoutOrStderr(result) || "tar extraction failed");
    return;
  }
  if (archive.endsWith(".zip")) {
    const result = spawn("unzip", ["-q", archive, "-d", destination], {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
      env: buildRuntimeEnv(cwd),
    });
    if (result.status !== 0) throw new Error(stdoutOrStderr(result) || "zip extraction failed");
    return;
  }
  throw new Error(`Unsupported archive format: ${archive}`);
}

function installK6(cwd, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const existing = shipflowExecutablePath(cwd, "k6");
  if (existing) return { ok: true, installed: false, path: existing };

  ensureRuntimeDirs(cwd);
  const release = curlJson("https://api.github.com/repos/grafana/k6/releases/latest", cwd, spawn);
  const asset = pickReleaseAsset(release.assets || [], "k6", deps.platform || process.platform, deps.arch || process.arch);
  if (!asset?.browser_download_url) {
    return {
      ok: false,
      installed: false,
      issue: `Automatic k6 bootstrap is not available for ${deps.platform || process.platform}/${deps.arch || process.arch}.`,
    };
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-k6-"));
  try {
    const archive = path.join(tmpRoot, asset.name);
    const extractDir = path.join(tmpRoot, "extract");
    fs.mkdirSync(extractDir, { recursive: true });
    downloadFile(asset.browser_download_url, archive, cwd, spawn);
    extractArchive(archive, extractDir, cwd, spawn);
    const binary = recursiveFindExecutable(extractDir, process.platform === "win32" ? ["k6.exe"] : ["k6"]);
    if (!binary) {
      return { ok: false, installed: false, issue: "k6 archive downloaded but no executable was found." };
    }
    const destination = path.join(shipflowBinDir(cwd), process.platform === "win32" ? "k6.exe" : "k6");
    fs.copyFileSync(binary, destination);
    fs.chmodSync(destination, 0o755);
    return { ok: true, installed: true, path: destination };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function opaDownloadUrl(platform = process.platform, arch = process.arch) {
  if (platform === "linux" && arch === "x64") return "https://openpolicyagent.org/downloads/latest/opa_linux_amd64_static";
  if (platform === "linux" && arch === "arm64") return "https://openpolicyagent.org/downloads/latest/opa_linux_arm64_static";
  if (platform === "darwin" && arch === "x64") return "https://openpolicyagent.org/downloads/latest/opa_darwin_amd64_static";
  if (platform === "darwin" && arch === "arm64") return "https://openpolicyagent.org/downloads/latest/opa_darwin_arm64_static";
  return null;
}

function installOpa(cwd, deps = {}) {
  const existing = shipflowExecutablePath(cwd, "opa");
  if (existing) return { ok: true, installed: false, path: existing };
  const spawn = deps.spawnSync || spawnSync;
  const url = opaDownloadUrl(deps.platform || process.platform, deps.arch || process.arch);
  if (!url) {
    return {
      ok: false,
      installed: false,
      issue: `Automatic OPA bootstrap is not available for ${deps.platform || process.platform}/${deps.arch || process.arch}.`,
    };
  }

  ensureRuntimeDirs(cwd);
  const destination = path.join(shipflowBinDir(cwd), process.platform === "win32" ? "opa.exe" : "opa");
  try {
    downloadFile(url, destination, cwd, spawn);
    fs.chmodSync(destination, 0o755);
    return { ok: true, installed: true, path: destination };
  } catch (error) {
    return {
      ok: false,
      installed: false,
      issue: error instanceof Error ? error.message : "OPA download failed",
    };
  }
}

function bootstrapNativeBackends(cwd, requirements, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const exists = deps.commandExists || ((cmd) => runtimeCommandExists(cwd, cmd, spawn));
  const actions = [];
  const issues = [];
  const installedBackends = [];

  if (requirements.k6_required && !exists("k6")) {
    const result = (deps.installK6 || installK6)(cwd, deps);
    if (!result.ok) issues.push(`Failed to install k6 automatically: ${result.issue}`);
    else if (result.installed) {
      installedBackends.push("k6");
      actions.push(`Installed local k6 runtime in ${path.relative(cwd, result.path).replaceAll("\\", "/")}.`);
    }
  }

  if (requirements.opa_required && !exists("opa")) {
    const result = (deps.installOpa || installOpa)(cwd, deps);
    if (!result.ok) issues.push(`Failed to install OPA automatically: ${result.issue}`);
    else if (result.installed) {
      installedBackends.push("opa");
      actions.push(`Installed local OPA runtime in ${path.relative(cwd, result.path).replaceAll("\\", "/")}.`);
    }
  }

  return {
    ok: issues.length === 0,
    installed_backends: installedBackends,
    actions,
    issues,
  };
}

function hasPlaywrightRuntime(cwd) {
  const dir = shipflowPlaywrightDir(cwd);
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
}

export function bootstrapVerificationRuntime(cwd, deps = {}) {
  const config = deps.config || readConfig(cwd);
  if (config.impl?.autoBootstrap === false) {
    return {
      ok: true,
      skipped: true,
      package_manager: detectPackageManager(cwd),
      requirements: collectVerificationRequirements(cwd),
      required_packages: [],
      missing_packages: [],
      installed_packages: [],
      actions: [],
      issues: [],
    };
  }

  const spawn = deps.spawnSync || spawnSync;
  const exists = deps.commandExists || ((cmd) => runtimeCommandExists(cwd, cmd, spawn));
  const requirements = deps.requirements || collectVerificationRequirements(cwd);
  const requiredPackages = requiredVerificationPackages(requirements);
  const missingPackages = requiredPackages.filter(pkg => !hasDependency(cwd, pkg) || !packageInstalled(cwd, pkg));
  const packageManager = detectPackageManager(cwd);
  const actions = [];
  const issues = [];
  const installedPackages = [];
  let createdPackageJson = false;

  actions.push(...ensureLocalToolchain(cwd, packageManager, deps));

  if (missingPackages.length > 0) {
    if (!exists(packageManager)) {
      issues.push(`Verification runtime bootstrap requires \`${packageManager}\`, but it is not installed.`);
    } else {
      const ensured = ensurePackageJson(cwd);
      if (!ensured.ok) {
        issues.push(ensured.issue);
      } else {
        createdPackageJson = ensured.created;
        if (createdPackageJson) actions.push("Created package.json for verification runtime bootstrap.");

        const command = installCommand(packageManager, missingPackages);
        const result = runCommand(cwd, command.bin, command.args, spawn);
        if (result.status !== 0) {
          const detail = stdoutOrStderr(result);
          issues.push(`Failed to install verification runtime packages with ${packageManager}: ${detail || "unknown error"}`);
        } else {
          installedPackages.push(...missingPackages);
          actions.push(`Installed verification runtime packages with ${packageManager}: ${missingPackages.join(", ")}`);
        }
      }
    }
  }

  const nativeBackends = bootstrapNativeBackends(cwd, requirements, deps);
  actions.push(...nativeBackends.actions);
  issues.push(...nativeBackends.issues);

  let playwrightBrowsersInstalled = false;
  let playwrightBrowsersReused = false;
  if (requirements.playwright_required && issues.length === 0) {
    if (!exists("npx")) {
      issues.push("Playwright browsers are required, but `npx` is not installed.");
    } else if (hasPlaywrightRuntime(cwd)) {
      playwrightBrowsersReused = true;
      actions.push("Reused local Playwright browser runtime.");
    } else {
      const result = runCommand(cwd, "npx", ["playwright", "install", "chromium"], spawn);
      if (result.status !== 0) {
        const detail = stdoutOrStderr(result);
        issues.push(`Failed to install Playwright browsers automatically: ${detail || "unknown error"}`);
      } else {
        playwrightBrowsersInstalled = true;
        actions.push("Installed Playwright Chromium runtime.");
      }
    }
  }

  return {
    ok: issues.length === 0,
    skipped: false,
    package_manager: packageManager,
    requirements,
    required_packages: requiredPackages,
    missing_packages: missingPackages,
    installed_packages: installedPackages,
    installed_backends: nativeBackends.installed_backends,
    created_package_json: createdPackageJson,
    playwright_browsers_installed: playwrightBrowsersInstalled,
    playwright_browsers_reused: playwrightBrowsersReused,
    actions,
    issues,
  };
}

export function syncProjectDependencies(cwd, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const exists = deps.commandExists || ((cmd) => runtimeCommandExists(cwd, cmd, spawn));
  const packageManager = detectPackageManager(cwd);
  const fingerprint = dependencyFingerprint(cwd);
  const actions = [];
  const issues = [];

  actions.push(...ensureLocalToolchain(cwd, packageManager, deps));

  if (!fingerprint) {
    return {
      ok: true,
      skipped: true,
      reason: "no package manifests",
      package_manager: packageManager,
      fingerprint: null,
      actions,
      issues,
    };
  }

  const nodeModulesPresent = fs.existsSync(path.join(cwd, "node_modules"));
  if (deps.previousFingerprint && deps.previousFingerprint === fingerprint && nodeModulesPresent) {
    return {
      ok: true,
      skipped: true,
      reason: "manifests unchanged",
      package_manager: packageManager,
      fingerprint,
      actions,
      issues,
    };
  }

  if (!exists(packageManager)) {
    issues.push(`Project dependency sync requires \`${packageManager}\`, but it is not installed.`);
    return {
      ok: false,
      skipped: false,
      package_manager: packageManager,
      fingerprint,
      actions,
      issues,
    };
  }

  const command = syncCommand(packageManager);
  const result = runCommand(cwd, command.bin, command.args, spawn);
  if (result.status !== 0) {
    issues.push(`Failed to sync project dependencies with ${packageManager}: ${stdoutOrStderr(result) || "unknown error"}`);
    return {
      ok: false,
      skipped: false,
      package_manager: packageManager,
      fingerprint,
      actions,
      issues,
    };
  }

  actions.push(`Synchronized project dependencies with ${packageManager}.`);
  return {
    ok: true,
    skipped: false,
    package_manager: packageManager,
    fingerprint,
    actions,
    issues,
  };
}
