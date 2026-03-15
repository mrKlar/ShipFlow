import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeVerificationPackSnapshot } from "../../lib/util/vp-snapshot.js";
import { countVerificationPack, buildImplementationReport, projectRunHints, summarizeImplementationHistory, writeImplementationHistory, run } from "../../lib/loop.js";
import { impl as applyImpl } from "../../lib/impl.js";
import { createTempTodoExampleProject, todoExampleImplementationFileBlocks } from "../support/todo-example.js";

function readJsonLines(file) {
  return fs.readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

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

describe("projectRunHints", () => {
  it("suggests a local-toolchain-safe dev command when ShipFlow captured a package manager shim", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-hints-"));
    try {
      fs.mkdirSync(path.join(tmpDir, ".shipflow", "runtime", "bin"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".shipflow", "runtime", "bin", "npm"), "#!/usr/bin/env bash\nexit 0\n");
      fs.chmodSync(path.join(tmpDir, ".shipflow", "runtime", "bin", "npm"), 0o755);
      fs.writeFileSync(path.join(tmpDir, ".shipflow", "runtime", "activate.sh"), "#!/usr/bin/env bash\n");
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        name: "tmp-app",
        private: true,
        scripts: {
          dev: "node server.js",
          test: "node --test",
        },
      }, null, 2));

      const hints = projectRunHints(tmpDir);
      assert.ok(hints.some(hint => hint.includes("source .shipflow/runtime/activate.sh && npm run dev")));
      assert.ok(hints.some(hint => hint.includes("source .shipflow/runtime/activate.sh")));
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

  it("writes structured orchestrator logs for the full implementation loop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-logs-"));
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
          collectStatus: () => ({ implementation_gate: { ready: true, blocking_reasons: [] } }),
          bootstrapVerificationRuntime: () => ({ ok: true, actions: ["Bootstrapped runtime"], issues: [] }),
          applyProjectScaffold: () => ({ ok: true, skipped: true, actions: [], issues: [], applied: false, preset: null }),
          syncProjectDependencies: () => ({ ok: true, actions: ["Dependencies already in sync"], issues: [], fingerprint: "fp-1" }),
          buildDoctor: () => ({ ok: true, issues: [] }),
          runLint: () => ({ ok: true, issues: [] }),
          gen: async () => {
            fs.mkdirSync(path.join(tmpDir, ".gen"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({ outputs: {} }));
          },
          impl: async () => ({
            written: ["src/server.js"],
            strategyPlan: {
              approach: "API-first",
              changed_approach: false,
            },
            specialists: [
              { role: "api", status: "wrote", written_files: ["src/server.js"] },
            ],
          }),
          verify: async () => {
            fs.mkdirSync(path.join(tmpDir, "evidence"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, "evidence", "run.json"), JSON.stringify({
              ok: true,
              passed: 1,
              failed: 0,
              groups: [{ kind: "ui", label: "UI", ok: true, passed: 1 }],
            }, null, 2));
            return { exitCode: 0, output: "1 passed" };
          },
        },
      });

      assert.equal(exitCode, 0);
      const events = readJsonLines(path.join(tmpDir, "evidence", "implement-log.jsonl"));
      assert.deepEqual(events.map(event => event.step), events.map((_, index) => index + 1));
      assert.ok(events.some(event => event.event === "run.started"));
      assert.ok(events.some(event => event.event === "stage.started" && event.stage === "bootstrap"));
      assert.ok(events.some(event => event.event === "stage.completed" && event.stage === "gen"));
      assert.ok(events.some(event => event.event === "iteration.started" && event.iteration === 1));
      assert.ok(events.some(event => event.event === "delegation.round_completed" && event.iteration === 1));
      assert.ok(events.some(event => event.event === "stage.completed" && event.stage === "verify"));
      assert.ok(events.some(event => event.event === "run.passed"));

      const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement-log-manifest.json"), "utf-8"));
      assert.equal(manifest.last_step, events.length);
      assert.ok(manifest.actors.some(actor => actor.actor_id === "orchestrator"));
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
          impl: async () => ({ written: ["src/server.js"], strategyPlan: null, specialists: [] }),
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

  it("applies the deterministic scaffold and syncs dependencies before doctor and implementation", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-scaffold-"));
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
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        impl: {
          provider: "command",
          maxIterations: 1,
          context: "Build a browser app with a GraphQL API and SQLite storage.",
          scaffold: {
            enabled: true,
            preset: "node-web-graphql-sqlite",
          },
        },
      }, null, 2));

      const order = [];
      const exitCode = await run({
        cwd: tmpDir,
        deps: {
          collectStatus: () => ({ implementation_gate: { ready: true, blocking_reasons: [] } }),
          bootstrapVerificationRuntime: () => {
            order.push("bootstrap");
            return { ok: true, actions: [], issues: [] };
          },
          applyProjectScaffold: () => {
            order.push("scaffold");
            return {
              ok: true,
              skipped: false,
              actions: ["Created src/server.js."],
              issues: [],
              applied: true,
              preset: "node-web-graphql-sqlite",
            };
          },
          syncProjectDependencies: () => {
            order.push("install");
            return { ok: true, actions: [], issues: [], fingerprint: "scaffold-fp" };
          },
          buildDoctor: () => {
            order.push("doctor");
            return { ok: true, issues: [] };
          },
          runLint: () => {
            order.push("lint");
            return { ok: true, issues: [] };
          },
          gen: async () => {
            order.push("gen");
            fs.mkdirSync(path.join(tmpDir, ".gen"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({ outputs: {} }));
          },
          impl: async () => {
            order.push("impl");
            return { written: [], strategyPlan: null, specialists: [] };
          },
          verify: async ({ cwd }) => {
            order.push("verify");
            fs.mkdirSync(path.join(cwd, "evidence"), { recursive: true });
            fs.writeFileSync(path.join(cwd, "evidence", "run.json"), JSON.stringify({
              ok: true,
              passed: 1,
              failed: 0,
              groups: [{ kind: "ui", label: "UI", ok: true, failed: 0 }],
            }, null, 2));
            return { exitCode: 0, output: "Summary: 1 passed, 0 failed" };
          },
        },
      });

      const evidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement.json"), "utf-8"));
      assert.equal(exitCode, 0);
      assert.deepEqual(order, ["bootstrap", "scaffold", "install", "doctor", "lint", "gen", "impl", "verify"]);
      assert.equal(evidence.scaffold_ok, true);
      assert.equal(evidence.scaffold_applied, true);
      assert.equal(evidence.scaffold_preset, "node-web-graphql-sqlite");
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

  it("forces a changed strategy after stalled verification rounds", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-stall-"));
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
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        impl: {
          provider: "command",
          maxIterations: 3,
          maxDurationMs: 60000,
          stagnationThreshold: 1,
          srcDir: "src",
          team: {
            enabled: true,
            maxTasksPerIteration: 2,
            memoHistory: 4,
            roles: ["architecture", "ui", "api", "database", "security", "technical"],
          },
        },
      }, null, 2));

      const orchestrationCalls = [];
      const exitCode = await run({
        cwd: tmpDir,
        deps: {
          collectStatus: () => ({ implementation_gate: { ready: true, blocking_reasons: [] } }),
          bootstrapVerificationRuntime: () => ({ ok: true, actions: [], issues: [] }),
          buildDoctor: () => ({ ok: true, issues: [] }),
          runLint: () => ({ ok: true, issues: [] }),
          gen: async () => {
            fs.mkdirSync(path.join(tmpDir, ".gen"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({ outputs: {} }));
          },
          impl: async ({ orchestration }) => {
            orchestrationCalls.push(orchestration);
            return {
              written: ["src/server.js"],
              strategyPlan: {
                summary: "Keep pushing the API failure.",
                approach: `attempt-${orchestrationCalls.length}`,
                changed_approach: orchestration.mustChangeStrategy,
                root_causes: ["API still failing"],
                assignments: [{ role: "api", goal: "Fix API", why_now: "API is still red", focus_types: ["api"] }],
              },
              specialists: [{ role: "api", written_files: ["src/server.js"] }],
            };
          },
          syncProjectDependencies: () => ({ ok: true, actions: [], issues: [], fingerprint: "stall" }),
          verify: async ({ cwd }) => {
            fs.mkdirSync(path.join(cwd, "evidence"), { recursive: true });
            fs.writeFileSync(path.join(cwd, "evidence", "run.json"), JSON.stringify({
              ok: false,
              passed: 1,
              failed: 1,
              groups: [{ kind: "api", label: "API", ok: false, failed: 1 }],
            }, null, 2));
            return { exitCode: 1, output: "Summary: 1 passed, 1 failed\nAPI: FAIL" };
          },
        },
      });

      const thread = JSON.parse(fs.readFileSync(path.join(tmpDir, ".shipflow", "implement-thread.json"), "utf-8"));
      assert.equal(exitCode, 1);
      assert.equal(orchestrationCalls.length, 3);
      assert.equal(orchestrationCalls[0].mustChangeStrategy, false);
      assert.equal(orchestrationCalls[1].mustChangeStrategy, false);
      assert.equal(orchestrationCalls[2].mustChangeStrategy, true);
      assert.equal(thread.stagnation_streak, 2);
      assert.equal(thread.attempts.length, 3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("stops when the overall implementation duration budget is exhausted", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-budget-"));
    let currentTime = 0;
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
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        impl: {
          provider: "command",
          maxIterations: 10,
          maxDurationMs: 1000,
          stagnationThreshold: 2,
          srcDir: "src",
        },
      }, null, 2));

      const exitCode = await run({
        cwd: tmpDir,
        deps: {
          now: () => currentTime,
          collectStatus: () => ({ implementation_gate: { ready: true, blocking_reasons: [] } }),
          bootstrapVerificationRuntime: () => ({ ok: true, actions: [], issues: [] }),
          buildDoctor: () => ({ ok: true, issues: [] }),
          runLint: () => ({ ok: true, issues: [] }),
          gen: async () => {
            fs.mkdirSync(path.join(tmpDir, ".gen"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({ outputs: {} }));
          },
          impl: async () => {
            currentTime = 400;
            return { written: ["src/server.js"], strategyPlan: null, specialists: [] };
          },
          syncProjectDependencies: () => ({ ok: true, actions: [], issues: [], fingerprint: "budget" }),
          verify: async ({ cwd }) => {
            currentTime = 1500;
            fs.mkdirSync(path.join(cwd, "evidence"), { recursive: true });
            fs.writeFileSync(path.join(cwd, "evidence", "run.json"), JSON.stringify({
              ok: false,
              passed: 1,
              failed: 1,
              groups: [{ kind: "ui", label: "UI", ok: false, failed: 1 }],
            }, null, 2));
            return { exitCode: 1, output: "Summary: 1 passed, 1 failed\nUI: FAIL" };
          },
        },
      });

      const evidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement.json"), "utf-8"));
      assert.equal(exitCode, 1);
      assert.equal(evidence.stage, "budget");
      assert.equal(evidence.iterations, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("continues the global loop when specialists return blocker reports without writing files", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-run-blocked-"));
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
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        impl: {
          provider: "command",
          maxIterations: 1,
          maxDurationMs: 60000,
          stagnationThreshold: 2,
          srcDir: "src",
        },
      }, null, 2));

      let installCalls = 0;
      const exitCode = await run({
        cwd: tmpDir,
        deps: {
          collectStatus: () => ({ implementation_gate: { ready: true, blocking_reasons: [] } }),
          bootstrapVerificationRuntime: () => ({ ok: true, actions: [], issues: [] }),
          buildDoctor: () => ({ ok: true, issues: [] }),
          runLint: () => ({ ok: true, issues: [] }),
          gen: async () => {
            fs.mkdirSync(path.join(tmpDir, ".gen"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({ outputs: {} }));
          },
          impl: async () => ({
            written: [],
            strategyPlan: {
              summary: "Return blocked.",
              approach: "Blocked-first",
              changed_approach: false,
              root_causes: ["No simple slice-level fix"],
              assignments: [{ role: "architecture", goal: "Diagnose", why_now: "Need strategy", focus_types: ["technical"] }],
            },
            specialists: [{
              role: "architecture",
              status: "blocked",
              written_files: [],
              blocker_report: {
                summary: "The architecture slice exhausted the straightforward ideas and needs a reordered plan.",
                exhausted_simple_paths: true,
                tried: ["checked the existing server skeleton"],
                blockers: ["The next logical step belongs to the API slice"],
                handoff_role: "api",
                suggested_next_step: "Lead with the API slice next round.",
              },
            }],
          }),
          syncProjectDependencies: () => {
            installCalls += 1;
            return { ok: true, actions: [], issues: [], fingerprint: "blocked" };
          },
          verify: async ({ cwd }) => {
            fs.mkdirSync(path.join(cwd, "evidence"), { recursive: true });
            fs.writeFileSync(path.join(cwd, "evidence", "run.json"), JSON.stringify({
              ok: false,
              passed: 0,
              failed: 1,
              groups: [{ kind: "ui", label: "UI", ok: false, failed: 1 }],
            }, null, 2));
            return { exitCode: 1, output: "Summary: 0 passed, 1 failed\nUI: FAIL" };
          },
        },
      });

      const thread = JSON.parse(fs.readFileSync(path.join(tmpDir, ".shipflow", "implement-thread.json"), "utf-8"));
      assert.equal(exitCode, 1);
      assert.equal(installCalls, 0);
      assert.equal(thread.attempts.length, 1);
      assert.equal(thread.attempts[0].specialists[0].status, "blocked");
      assert.equal(thread.attempts[0].specialists[0].handoff_role, "api");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("completes a temporary todo example project and records a green verification report", async () => {
    const tmpDir = createTempTodoExampleProject();
    try {
      const exitCode = await run({
        cwd: tmpDir,
        provider: "command",
        deps: {
          collectStatus: () => ({ implementation_gate: { ready: true, blocking_reasons: [] } }),
          bootstrapVerificationRuntime: () => ({ ok: true, actions: [], issues: [] }),
          buildDoctor: () => ({ ok: true, issues: [] }),
          syncProjectDependencies: () => ({ ok: true, actions: [], issues: [], fingerprint: "todo-example" }),
          impl: async ({ cwd, errors }) => applyImpl({
            cwd,
            errors,
            provider: "command",
            deps: {
              generateWithProvider: async () => todoExampleImplementationFileBlocks(),
            },
          }),
          verify: async ({ cwd }) => {
            fs.mkdirSync(path.join(cwd, "evidence"), { recursive: true });
            fs.writeFileSync(path.join(cwd, "evidence", "run.json"), JSON.stringify({
              ok: true,
              passed: 9,
              failed: 0,
              groups: [
                { kind: "ui", label: "UI", ok: true, failed: 0 },
                { kind: "api", label: "API", ok: true, failed: 0 },
                { kind: "db", label: "Database", ok: true, failed: 0 },
                { kind: "technical", label: "Technical", ok: true, failed: 0 },
              ],
            }, null, 2));
            return { exitCode: 0, output: "todo verification checks passed" };
          },
        },
      });

      const evidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement.json"), "utf-8"));
      const history = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement-history.json"), "utf-8"));
      assert.equal(exitCode, 0);
      assert.equal(evidence.ok, true);
      assert.equal(evidence.stage, "verify");
      assert.equal(evidence.iterations, 1);
      assert.equal(evidence.vp_counts.ui, 3);
      assert.equal(evidence.generated_counts.ui, 4);
      assert.equal(evidence.generated_counts.api, 4);
      assert.equal(evidence.generated_counts.technical, 4);
      assert.equal(evidence.generated_counts.security, 1);
      assert.equal(history.summary.total_runs, 1);
      assert.equal(history.summary.passed_runs, 1);
      assert.equal(history.summary.first_pass_rate, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
