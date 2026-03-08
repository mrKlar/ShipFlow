import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildDoctor } from "../../lib/doctor.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-doctor-"));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("buildDoctor", () => {
  it("reports missing tooling and package dependencies", () => {
    withTmpDir(tmpDir => {
      const result = buildDoctor(tmpDir, { commandExists: () => false, env: {} });
      assert.equal(result.ok, false);
      assert.ok(result.issues.some(i => i.includes("Core Node.js tooling")));
      assert.ok(result.issues.some(i => i.includes("@playwright/test")));
      assert.ok(result.issues.some(i => i.includes("No supported AI CLI")));
      assert.ok(result.issues.some(i => i.includes("Anthropic provider")));
    });
  });

  it("passes when required basics are available", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({ impl: { provider: "auto" } }));
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }));
      fs.mkdirSync(path.join(tmpDir, ".codex"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".codex", "config.toml"), "sandbox_mode = \"workspace-write\"\n");
      const available = new Set(["node", "npm", "npx", "codex"]);
      const result = buildDoctor(tmpDir, {
        commandExists: cmd => available.has(cmd),
        env: {},
      });
      assert.equal(result.ok, true);
      assert.equal(result.checks.draft_provider, "local");
      assert.equal(result.checks.playwright_pkg, true);
      assert.equal(result.checks.codex, true);
      assert.equal(result.checks.impl_provider, "codex");
      assert.equal(result.checks.impl_provider_ready, true);
    });
  });

  it("validates command provider readiness", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        impl: { provider: "command", command: { bin: "codex", args: ["exec"] } },
      }));
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }));
      const available = new Set(["node", "npm", "npx", "codex"]);
      const result = buildDoctor(tmpDir, { commandExists: cmd => available.has(cmd), env: {} });
      assert.equal(result.ok, true);
      assert.equal(result.checks.impl_provider, "command");
      assert.equal(result.checks.impl_provider_ready, true);
    });
  });
});
