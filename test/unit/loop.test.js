import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeVerificationPackSnapshot } from "../../lib/util/vp-snapshot.js";
import { countVerificationPack, buildImplementationReport, summarizeImplementationHistory, writeImplementationHistory, run } from "../../lib/loop.js";

describe("countVerificationPack", () => {
  it("counts verifications by type", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-loop-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "api"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "security"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\n");
      fs.writeFileSync(path.join(tmpDir, "vp", "api", "users.yml"), "id: users\n");
      fs.writeFileSync(path.join(tmpDir, "vp", "security", "admin.yaml"), "id: admin\n");
      const counts = countVerificationPack(tmpDir);
      assert.equal(counts.ui, 1);
      assert.equal(counts.api, 1);
      assert.equal(counts.security, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("buildImplementationReport", () => {
  it("captures first-pass success and retry counts", () => {
    const report = buildImplementationReport({
      startedAt: Date.now() - 50,
      stage: "verify",
      ok: true,
      exitCode: 0,
      iterations: 1,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      vpCounts: { ui: 1 },
      generatedCounts: { ui: 1 },
      attempts: [{ iteration: 1, verify_exit_code: 0, ok: true }],
    });
    assert.equal(report.first_pass_success, true);
    assert.equal(report.retries_used, 0);
    assert.equal(report.provider, "anthropic");
  });
});

describe("implementation history", () => {
  it("summarizes pass rate, first-pass rate, and provider usage", () => {
    const summary = summarizeImplementationHistory([
      {
        ok: true,
        first_pass_success: true,
        iterations: 1,
        duration_ms: 100,
        provider: "anthropic",
        started_at: "2026-03-08T10:00:00.000Z",
      },
      {
        ok: false,
        first_pass_success: false,
        iterations: 3,
        duration_ms: 300,
        provider: "command",
        started_at: "2026-03-08T11:00:00.000Z",
      },
    ]);
    assert.equal(summary.total_runs, 2);
    assert.equal(summary.pass_rate, 0.5);
    assert.equal(summary.first_pass_rate, 0.5);
    assert.equal(summary.average_iterations, 2);
    assert.equal(summary.by_provider.anthropic, 1);
    assert.equal(summary.by_provider.command, 1);
    assert.equal(summary.last_success_at, "2026-03-08T10:00:00.000Z");
    assert.equal(summary.last_failure_at, "2026-03-08T11:00:00.000Z");
  });

  it("writes bounded implement history without replacing implement.json semantics", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-history-"));
    try {
      writeImplementationHistory(tmpDir, {
        started_at: "2026-03-08T10:00:00.000Z",
        duration_ms: 120,
        stage: "verify",
        ok: true,
        exit_code: 0,
        iterations: 1,
        first_pass_success: true,
        retries_used: 0,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        doctor_ok: true,
        lint_ok: true,
        vp_counts: { ui: 1 },
        generated_counts: { ui: 1 },
      }, 2);
      writeImplementationHistory(tmpDir, {
        started_at: "2026-03-08T11:00:00.000Z",
        duration_ms: 180,
        stage: "verify",
        ok: false,
        exit_code: 1,
        iterations: 3,
        first_pass_success: false,
        retries_used: 2,
        provider: "command",
        model: "codex",
        doctor_ok: true,
        lint_ok: true,
        vp_counts: { ui: 2 },
        generated_counts: { ui: 2 },
      }, 2);
      writeImplementationHistory(tmpDir, {
        started_at: "2026-03-08T12:00:00.000Z",
        duration_ms: 90,
        stage: "verify",
        ok: true,
        exit_code: 0,
        iterations: 2,
        first_pass_success: false,
        retries_used: 1,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        doctor_ok: true,
        lint_ok: true,
        vp_counts: { ui: 3 },
        generated_counts: { ui: 3 },
      }, 2);

      const history = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement-history.json"), "utf-8"));
      assert.equal(history.runs.length, 2);
      assert.equal(history.summary.total_runs, 2);
      assert.equal(history.summary.passed_runs, 1);
      assert.equal(history.summary.failed_runs, 1);
      assert.equal(history.runs[0].started_at, "2026-03-08T11:00:00.000Z");
      assert.equal(history.runs[1].started_at, "2026-03-08T12:00:00.000Z");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("run", () => {
  it("stops at bootstrap when verification runtime bootstrap fails", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-bootstrap-"));
    try {
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

      const exitCode = await run({
        cwd: tmpDir,
        deps: {
          bootstrapVerificationRuntime: () => ({
            ok: false,
            actions: [],
            issues: ["npm is missing"],
          }),
          buildDoctor: () => {
            throw new Error("doctor should not run after bootstrap failure");
          },
        },
      });
      const evidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement.json"), "utf-8"));
      assert.equal(exitCode, 1);
      assert.equal(evidence.stage, "bootstrap");
      assert.equal(evidence.bootstrap_ok, false);
      assert.equal(evidence.iterations, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("stops at install when project dependency sync fails after implementation", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-install-"));
    try {
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
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        private: true,
        devDependencies: { "@playwright/test": "^1.0.0" },
      }));

      const exitCode = await run({
        cwd: tmpDir,
        deps: {
          bootstrapVerificationRuntime: () => ({ ok: true, actions: [], issues: [] }),
          buildDoctor: () => ({ ok: true, issues: [] }),
          runLint: () => ({ ok: true, issues: [] }),
          gen: async () => {
            fs.mkdirSync(path.join(tmpDir, ".gen"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({ outputs: {} }));
          },
          impl: async () => {},
          syncProjectDependencies: () => ({ ok: false, actions: [], issues: ["npm install failed"] }),
        },
      });
      const evidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement.json"), "utf-8"));
      assert.equal(exitCode, 1);
      assert.equal(evidence.stage, "install");
      assert.equal(evidence.install_ok, false);
      assert.equal(evidence.iterations, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("blocks implementation when the draft session still has pending proposals", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-draft-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".shipflow"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".shipflow", "draft-session.json"), JSON.stringify({
        version: 1,
        request: "todo app",
        review: {
          accepted: 0,
          rejected: 0,
          pending: 1,
          suggested_write: 1,
        },
        proposals: [{
          path: "vp/ui/home.yml",
          type: "ui",
          confidence: "high",
          review: {
            decision: "pending",
            suggested_write: true,
          },
          data: {
            id: "ui-home",
            title: "Home screen is visible",
            severity: "blocker",
            app: { kind: "web", base_url: "http://localhost:3000" },
            flow: [{ open: "/" }],
            assert: [{ visible: { testid: "home" } }],
          },
        }],
      }, null, 2));

      const exitCode = await run({ cwd: tmpDir });
      const evidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement.json"), "utf-8"));
      assert.equal(exitCode, 1);
      assert.equal(evidence.stage, "draft");
      assert.equal(evidence.iterations, 0);
      assert.equal(evidence.ok, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("lets implementation continue past the draft gate when accepted proposals are already written", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-doctor-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".shipflow"), { recursive: true });
      const proposal = {
        id: "ui-home",
        title: "Home screen is visible",
        severity: "blocker",
        app: { kind: "web", base_url: "http://localhost:3000" },
        flow: [{ open: "/" }],
        assert: [{ visible: { testid: "home" } }],
      };
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
      const vpSnapshot = computeVerificationPackSnapshot(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".shipflow", "draft-session.json"), JSON.stringify({
        version: 1,
        request: "todo app",
        review: {
          accepted: 1,
          rejected: 0,
          pending: 0,
          suggested_write: 1,
        },
        vp_snapshot: vpSnapshot,
        proposals: [{
          path: "vp/ui/home.yml",
          type: "ui",
          confidence: "high",
          review: {
            decision: "accept",
            suggested_write: true,
          },
          data: proposal,
        }],
        written: ["vp/ui/home.yml"],
      }, null, 2));

      const exitCode = await run({
        cwd: tmpDir,
        deps: {
          bootstrapVerificationRuntime: () => ({ ok: true, actions: [], issues: [] }),
          buildDoctor: () => ({ ok: false, issues: ["doctor failed"] }),
        },
      });
      const evidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement.json"), "utf-8"));
      assert.equal(exitCode, 1);
      assert.equal(evidence.stage, "doctor");
      assert.equal(evidence.iterations, 0);
      assert.equal(evidence.ok, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("blocks implementation when the verification pack changed after the last saved draft session", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-stale-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".shipflow"), { recursive: true });
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
      const reviewedSnapshot = computeVerificationPackSnapshot(tmpDir);
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
        "      testid: changed-home",
        "",
      ].join("\n"));
      fs.writeFileSync(path.join(tmpDir, ".shipflow", "draft-session.json"), JSON.stringify({
        version: 1,
        request: "todo app",
        review: {
          accepted: 1,
          rejected: 0,
          pending: 0,
          suggested_write: 1,
        },
        vp_snapshot: reviewedSnapshot,
        proposals: [{
          path: "vp/ui/home.yml",
          type: "ui",
          confidence: "high",
          review: {
            decision: "accept",
            suggested_write: true,
          },
          data: {
            id: "ui-home",
            title: "Home screen is visible",
            severity: "blocker",
            app: { kind: "web", base_url: "http://localhost:3000" },
            flow: [{ open: "/" }],
            assert: [{ visible: { testid: "home" } }],
          },
        }],
      }, null, 2));

      const exitCode = await run({ cwd: tmpDir });
      const evidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement.json"), "utf-8"));
      assert.equal(exitCode, 1);
      assert.equal(evidence.stage, "draft");
      assert.equal(evidence.iterations, 0);
      assert.equal(evidence.ok, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
