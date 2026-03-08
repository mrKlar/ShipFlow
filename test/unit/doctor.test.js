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
      assert.ok(result.issues.some(i => i.includes("No supported AI CLI")));
      assert.ok(result.issues.some(i => i.includes("Anthropic provider")));
    });
  });

  it("requires Playwright only when the pack needs Playwright-backed verifications", () => {
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
        "  - visible:",
        "      testid: home",
        "",
      ].join("\n"));
      const available = new Set(["node", "npm", "npx", "codex"]);
      const result = buildDoctor(tmpDir, { commandExists: cmd => available.has(cmd), env: {} });
      assert.equal(result.ok, false);
      assert.ok(result.issues.some(i => i.includes("@playwright/test")));
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

  it("recognizes kiro-cli as a supported installed AI CLI", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({ impl: { provider: "auto" } }));
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }));
      fs.writeFileSync(path.join(tmpDir, "KIRO.md"), "# ShipFlow\n");
      const available = new Set(["node", "npm", "npx", "kiro-cli"]);
      const result = buildDoctor(tmpDir, {
        commandExists: cmd => available.has(cmd),
        env: {},
      });
      assert.equal(result.checks.kiro, true);
      assert.equal(result.checks.impl_provider, "kiro");
      assert.equal(result.checks.impl_provider_ready, true);
    });
  });

  it("fails when required execution backends from the verification pack are missing", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "vp", "nfr"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "db"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "policy"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "technical"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({ impl: { provider: "auto" } }));
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        devDependencies: { "@playwright/test": "^1.0.0" },
      }));
      fs.writeFileSync(path.join(tmpDir, "vp", "nfr", "load.yml"), [
        "id: perf-load",
        "title: Load check",
        "severity: blocker",
        "app:",
        "  kind: nfr",
        "  base_url: http://localhost:3000",
        "scenario:",
        "  endpoint: /api/health",
        "  thresholds:",
        "    http_req_duration_p95: 300",
        "  vus: 1",
        "  duration: 10s",
        "",
      ].join("\n"));
      fs.writeFileSync(path.join(tmpDir, "vp", "db", "sqlite.yml"), [
        "id: db-sqlite",
        "title: SQLite check",
        "severity: blocker",
        "app:",
        "  kind: db",
        "  engine: sqlite",
        "  connection: ./test.db",
        "query: SELECT 1 AS value;",
        "assert:",
        "  - row_count: 1",
        "",
      ].join("\n"));
      fs.writeFileSync(path.join(tmpDir, "vp", "policy", "guard.rego"), "package shipflow\n");
      fs.writeFileSync(path.join(tmpDir, "vp", "technical", "architecture.yml"), [
        "id: technical-architecture",
        "title: Architecture checks",
        "severity: blocker",
        "category: architecture",
        "runner:",
        "  kind: archtest",
        "  framework: tsarch",
        "app:",
        "  kind: technical",
        "  root: .",
        "assert:",
        "  - command_succeeds:",
        "      command: npx tsarch --help",
        "",
      ].join("\n"));

      const available = new Set(["node", "npm", "npx", "codex"]);
      const result = buildDoctor(tmpDir, {
        commandExists: cmd => available.has(cmd),
        env: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.issues.some(issue => issue.includes("`k6`")));
      assert.ok(result.issues.some(issue => issue.includes("`opa`")));
      assert.ok(result.issues.some(issue => issue.includes("`sqlite3`")));
      assert.ok(result.issues.some(issue => issue.includes("tsarch")));
    });
  });

  it("passes required execution backend checks when the pack dependencies are available", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "vp", "db"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "technical"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({ impl: { provider: "auto" } }));
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        devDependencies: {
          "@playwright/test": "^1.0.0",
          "tsarch": "^0.1.0",
        },
      }));
      fs.writeFileSync(path.join(tmpDir, "vp", "db", "postgres.yml"), [
        "id: db-postgres",
        "title: Postgres check",
        "severity: blocker",
        "app:",
        "  kind: db",
        "  engine: postgresql",
        "  connection: postgresql://localhost/test",
        "query: SELECT 1 AS value;",
        "assert:",
        "  - row_count: 1",
        "",
      ].join("\n"));
      fs.writeFileSync(path.join(tmpDir, "vp", "technical", "architecture.yml"), [
        "id: technical-architecture",
        "title: Architecture checks",
        "severity: blocker",
        "category: architecture",
        "runner:",
        "  kind: archtest",
        "  framework: tsarch",
        "app:",
        "  kind: technical",
        "  root: .",
        "assert:",
        "  - command_succeeds:",
        "      command: npx tsarch --help",
        "",
      ].join("\n"));

      const available = new Set(["node", "npm", "npx", "codex", "psql"]);
      const result = buildDoctor(tmpDir, {
        commandExists: cmd => available.has(cmd),
        env: {},
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.checks.requirements.db_engines, ["postgresql"]);
      assert.deepEqual(result.checks.requirements.technical_frameworks, ["tsarch"]);
    });
  });

  it("requires @cucumber/cucumber when behavior checks request the gherkin runner", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "vp", "behavior"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({ impl: { provider: "auto" } }));
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        devDependencies: { "@playwright/test": "^1.0.0" },
      }));
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
        "  - open: /checkout",
        "when:",
        "  - click:",
        "      testid: continue",
        "then:",
        "  - visible:",
        "      testid: payment",
        "",
      ].join("\n"));
      const available = new Set(["node", "npm", "npx", "codex"]);
      const result = buildDoctor(tmpDir, { commandExists: cmd => available.has(cmd), env: {} });
      assert.equal(result.ok, false);
      assert.deepEqual(result.checks.requirements.behavior_frameworks, ["cucumber"]);
      assert.ok(result.issues.some(issue => issue.includes("@cucumber/cucumber") || issue.includes("cucumber")));
    });
  });
});
