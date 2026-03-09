import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootstrapVerificationRuntime, detectPackageManager } from "../../lib/bootstrap.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-bootstrap-"));
  try {
    return fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function makeSpawnRecorder(cwd, calls) {
  return (bin, args, options = {}) => {
    calls.push({ bin, args: [...args] });
    if (bin === "npm" && args[0] === "install") {
      const pkgPath = path.join(cwd, "package.json");
      const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, "utf-8")) : { name: "tmp", private: true };
      pkg.devDependencies ||= {};
      for (const dep of args.slice(2)) {
        if (dep.startsWith("-")) continue;
        pkg.devDependencies[dep] = "^0.0.0";
      }
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (bin === "npx" && args[0] === "playwright" && args[1] === "install") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (bin === "bash" && args[0] === "-lc") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
}

describe("detectPackageManager", () => {
  it("prefers packageManager from package.json", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ packageManager: "pnpm@9.0.0" }));
      assert.equal(detectPackageManager(tmpDir), "pnpm");
    });
  });

  it("falls back to known lockfiles", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "yarn.lock"), "");
      assert.equal(detectPackageManager(tmpDir), "yarn");
    });
  });
});

describe("bootstrapVerificationRuntime", () => {
  it("skips automatic bootstrap when disabled in config", () => {
    withTmpDir(tmpDir => {
      const result = bootstrapVerificationRuntime(tmpDir, {
        config: { impl: { autoBootstrap: false } },
      });
      assert.equal(result.ok, true);
      assert.equal(result.skipped, true);
    });
  });

  it("creates package.json and installs required verification runtime packages", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "behavior"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), [
        "id: ui-home",
        "title: Home screen is visible",
        "severity: blocker",
        "app:",
        "  kind: web",
        "  base_url: http://localhost:3000",
        "flow:",
        "  - open: /",
        "assert:",
        "  - url_matches:",
        "      regex: /",
        "",
      ].join("\n"));
      fs.writeFileSync(path.join(tmpDir, "vp", "behavior", "checkout.yml"), [
        "id: behavior-checkout",
        "feature: Checkout",
        "scenario: Guest checkout",
        "severity: blocker",
        "runner:",
        "  kind: gherkin",
        "  framework: cucumber",
        "app:",
        "  kind: web",
        "  base_url: http://localhost:3000",
        "given:",
        "  - open: /",
        "when: []",
        "then:",
        "  - url_matches:",
        "      regex: /",
        "",
      ].join("\n"));

      const calls = [];
      const spawnSync = makeSpawnRecorder(tmpDir, calls);
      const result = bootstrapVerificationRuntime(tmpDir, {
        spawnSync,
        commandExists: cmd => ["npm", "npx"].includes(cmd),
      });

      assert.equal(result.ok, true);
      assert.equal(result.created_package_json, true);
      assert.deepEqual(result.installed_packages, ["@cucumber/cucumber", "@playwright/test"]);
      assert.equal(result.playwright_browsers_installed, true);
      assert.ok(calls.some(call => call.bin === "npm" && call.args.includes("@playwright/test")));
      assert.ok(calls.some(call => call.bin === "npm" && call.args.includes("@cucumber/cucumber")));
      assert.ok(calls.some(call => call.bin === "npx" && call.args[0] === "playwright" && call.args[1] === "install"));

      const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8"));
      assert.ok(pkg.devDependencies["@playwright/test"]);
      assert.ok(pkg.devDependencies["@cucumber/cucumber"]);
    });
  });

  it("installs Playwright browsers even when @playwright/test is already declared", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), [
        "id: ui-home",
        "title: Home screen is visible",
        "severity: blocker",
        "app:",
        "  kind: web",
        "  base_url: http://localhost:3000",
        "flow:",
        "  - open: /",
        "assert:",
        "  - url_matches:",
        "      regex: /",
        "",
      ].join("\n"));
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        private: true,
        devDependencies: { "@playwright/test": "^1.0.0" },
      }, null, 2));

      const calls = [];
      const spawnSync = makeSpawnRecorder(tmpDir, calls);
      const result = bootstrapVerificationRuntime(tmpDir, {
        spawnSync,
        commandExists: cmd => ["npm", "npx"].includes(cmd),
      });

      assert.equal(result.ok, true);
      assert.deepEqual(result.installed_packages, ["@playwright/test"]);
      assert.equal(result.playwright_browsers_installed, true);
      assert.ok(calls.some(call => call.bin === "npm" && call.args.includes("@playwright/test")));
      assert.ok(calls.some(call => call.bin === "npx" && call.args[0] === "playwright" && call.args[1] === "install"));
    });
  });

  it("fails cleanly when package.json is invalid", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), [
        "id: ui-home",
        "title: Home screen is visible",
        "severity: blocker",
        "app:",
        "  kind: web",
        "  base_url: http://localhost:3000",
        "flow:",
        "  - open: /",
        "assert:",
        "  - url_matches:",
        "      regex: /",
        "",
      ].join("\n"));
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{ invalid json");
      const result = bootstrapVerificationRuntime(tmpDir, {
        commandExists: () => true,
        spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
      });
      assert.equal(result.ok, false);
      assert.ok(result.issues.some(issue => issue.includes("invalid JSON")));
    });
  });
});
