import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildImplementationMemo,
  compareVerificationProgress,
  createImplementationThread,
  fallbackStrategyDecision,
  normalizeImplementationBudget,
  normalizeImplementationTeam,
  recordImplementationAttempt,
  summarizeVerificationRun,
} from "../../lib/implementation-team.js";

describe("implementation team defaults", () => {
  it("normalizes budget defaults", () => {
    const budget = normalizeImplementationBudget({});
    assert.equal(budget.maxIterations, 50);
    assert.equal(budget.maxDurationMs, 21600000);
    assert.equal(budget.stagnationThreshold, 2);
  });

  it("normalizes team defaults", () => {
    const team = normalizeImplementationTeam({});
    assert.equal(team.enabled, true);
    assert.equal(team.maxTasksPerIteration, 6);
    assert.equal(team.memoHistory, 8);
    assert.deepEqual(team.roles, ["architecture", "ui", "api", "database", "security", "technical"]);
  });
});

describe("verification progress", () => {
  it("detects newly passing groups as progress", () => {
    const previous = summarizeVerificationRun({
      ok: false,
      passed: 3,
      failed: 2,
      groups: [
        { kind: "api", label: "API", ok: false, failed: 1 },
        { kind: "ui", label: "UI", ok: false, failed: 1 },
      ],
    });
    const current = summarizeVerificationRun({
      ok: false,
      passed: 4,
      failed: 1,
      groups: [
        { kind: "api", label: "API", ok: true, passed: 1 },
        { kind: "ui", label: "UI", ok: false, failed: 1 },
      ],
    });
    const progress = compareVerificationProgress(previous, current);
    assert.equal(progress.improved, true);
    assert.equal(progress.stagnated, false);
    assert.deepEqual(progress.newly_passing_groups, ["API"]);
    assert.deepEqual(progress.persistent_failures, ["UI"]);
  });

  it("detects stagnation when no counts or failing groups improve", () => {
    const previous = summarizeVerificationRun({
      ok: false,
      passed: 4,
      failed: 1,
      groups: [
        { kind: "ui", label: "UI", ok: false, failed: 1 },
      ],
    });
    const current = summarizeVerificationRun({
      ok: false,
      passed: 4,
      failed: 1,
      groups: [
        { kind: "ui", label: "UI", ok: false, failed: 1 },
      ],
    });
    const progress = compareVerificationProgress(previous, current);
    assert.equal(progress.improved, false);
    assert.equal(progress.stagnated, true);
    assert.deepEqual(progress.newly_passing_groups, []);
  });
});

describe("implementation thread", () => {
  it("records attempts and increments stagnation streak when progress stalls", () => {
    const team = normalizeImplementationTeam({});
    let thread = createImplementationThread({
      provider: "command",
      model: "test",
      team,
      budget: normalizeImplementationBudget({}),
      runId: "impl-test-run",
      lastEventSeq: 7,
    });
    assert.equal(thread.run_id, "impl-test-run");
    assert.equal(thread.last_event_seq, 7);

    thread = recordImplementationAttempt(thread, {
      iteration: 1,
      written_files: ["src/server.js"],
      strategy: {
        summary: "Try wiring the API first.",
        approach: "API-first",
        changed_approach: false,
        root_causes: ["Missing handler"],
        tasks: [{ task_id: "api-1", role: "api", goal: "Wire API" }],
      },
      specialists: [{ task_id: "api-1", role: "api", goal: "Wire API", written_files: ["src/server.js"] }],
      verify_run: {
        ok: false,
        passed: 2,
        failed: 1,
        groups: [{ kind: "api", label: "API", ok: false, failed: 1 }],
      },
    }, team);
    assert.equal(thread.stagnation_streak, 0);

    thread = recordImplementationAttempt(thread, {
      iteration: 2,
      written_files: ["src/server.js"],
      strategy: {
        summary: "Retry same area.",
        approach: "API-first",
        changed_approach: false,
        root_causes: ["Missing handler"],
        tasks: [{ task_id: "api-2", role: "api", goal: "Wire API" }],
      },
      specialists: [{ task_id: "api-2", role: "api", goal: "Wire API", written_files: ["src/server.js"] }],
      verify_run: {
        ok: false,
        passed: 2,
        failed: 1,
        groups: [{ kind: "api", label: "API", ok: false, failed: 1 }],
      },
    }, team);
    assert.equal(thread.stagnation_streak, 1);

    const memo = buildImplementationMemo(thread, 4);
    assert.equal(memo.stagnation_streak, 1);
    assert.equal(memo.recent_attempts.length, 2);
    assert.equal(memo.last_strategy.approach, "API-first");
    assert.equal(memo.last_strategy.tasks[0].task_id, "api-2");
  });
});

describe("fallbackStrategyDecision", () => {
  it("chooses the next one-shot task from the matching failing specialist role", () => {
    const decision = fallbackStrategyDecision({
      run: {
        failing_groups: [
          { kind: "ui", label: "UI" },
          { kind: "api", label: "API" },
          { kind: "db", label: "Database" },
        ],
      },
      team: normalizeImplementationTeam({}),
    });
    assert.equal(decision.continue_iteration, true);
    assert.equal(decision.next_task.role, "architecture");
    assert.ok(decision.tasks.some(item => item.role === "ui"));
    assert.ok(decision.tasks.some(item => item.role === "api"));
  });

  it("prefers the latest specialist handoff when falling back after a blocked slice", () => {
    const decision = fallbackStrategyDecision({
      run: {
        failing_groups: [
          { kind: "ui", label: "UI" },
        ],
      },
      team: normalizeImplementationTeam({}),
      attemptedRoles: ["api", "ui"],
      blockedResults: [
        {
          role: "ui",
          status: "blocked",
          blocker_report: {
            handoff_role: "technical",
            blockers: ["src/public/app.js still has invalid JavaScript syntax"],
            suggested_next_step: "Repair the UI syntax problem in src/public/app.js before retrying the UI slice.",
          },
        },
      ],
    });

    assert.equal(decision.next_task.role, "technical");
    assert.match(decision.next_task.goal, /Repair the UI syntax problem/i);
    assert.deepEqual(decision.next_task.target_groups, ["technical"]);
  });
});
