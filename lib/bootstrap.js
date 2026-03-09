import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readConfig } from "./config.js";
import { sha256 } from "./util/hash.js";
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
  });
}

function stdoutOrStderr(result) {
  return String(result.stderr || result.stdout || "").trim();
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
  const exists = deps.commandExists || ((cmd) => commandExists(cmd, spawn));
  const requirements = deps.requirements || collectVerificationRequirements(cwd);
  const requiredPackages = requiredVerificationPackages(requirements);
  const missingPackages = requiredPackages.filter(pkg => !hasDependency(cwd, pkg) || !packageInstalled(cwd, pkg));
  const packageManager = detectPackageManager(cwd);
  const actions = [];
  const issues = [];
  const installedPackages = [];
  let createdPackageJson = false;

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

  let playwrightBrowsersInstalled = false;
  if (requirements.playwright_required) {
    if (!exists("npx")) {
      issues.push("Playwright browsers are required, but `npx` is not installed.");
    } else {
      const result = runCommand(cwd, "npx", ["playwright", "install"], spawn);
      if (result.status !== 0) {
        const detail = stdoutOrStderr(result);
        issues.push(`Failed to install Playwright browsers automatically: ${detail || "unknown error"}`);
      } else {
        playwrightBrowsersInstalled = true;
        actions.push("Installed Playwright browsers.");
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
    created_package_json: createdPackageJson,
    playwright_browsers_installed: playwrightBrowsersInstalled,
    actions,
    issues,
  };
}

export function syncProjectDependencies(cwd, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const exists = deps.commandExists || ((cmd) => commandExists(cmd, spawn));
  const packageManager = detectPackageManager(cwd);
  const fingerprint = dependencyFingerprint(cwd);
  const actions = [];
  const issues = [];

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
