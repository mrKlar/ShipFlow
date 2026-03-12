import fs from "node:fs";
import path from "node:path";

export const IMPLEMENTATION_SPECIALIST_ROLES = {
  architecture: {
    role: "architecture",
    title: "Architecture Lead",
    focus: "Cross-layer design, root-cause diagnosis, integration boundaries, and structural fixes.",
  },
  ui: {
    role: "ui",
    title: "UI Specialist",
    focus: "Rendered UI, client state, interaction flows, visual contracts, and browser-facing behavior.",
  },
  api: {
    role: "api",
    title: "API Specialist",
    focus: "REST and GraphQL handlers, schema/contracts, transport normalization, and upstream API calls.",
  },
  database: {
    role: "database",
    title: "Database Specialist",
    focus: "Persistence models, read/write paths, queries, migrations, data-engineering, and storage correctness.",
  },
  security: {
    role: "security",
    title: "Security Specialist",
    focus: "Authentication, authorization, input validation, policy checks, and security regressions.",
  },
  technical: {
    role: "technical",
    title: "Technical Specialist",
    focus: "Runtime, dependencies, startup/build tooling, environment wiring, and technical verification gates.",
  },
};

export const DEFAULT_IMPLEMENTATION_TEAM = {
  enabled: true,
  maxSpecialistsPerIteration: 4,
  memoHistory: 8,
  roles: Object.keys(IMPLEMENTATION_SPECIALIST_ROLES),
};

export const DEFAULT_IMPLEMENTATION_BUDGET = {
  maxIterations: 50,
  maxDurationMs: 6 * 60 * 60 * 1000,
  stagnationThreshold: 2,
};

function normalizePositiveInteger(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.floor(Number(value));
  return rounded > 0 ? rounded : fallback;
}

function implementationThreadPath(cwd) {
  return path.join(cwd, ".shipflow", "implement-thread.json");
}

export function normalizeImplementationTeam(implConfig = {}) {
  const configured = implConfig?.team && typeof implConfig.team === "object" ? implConfig.team : {};
  const configuredRoles = Array.isArray(configured.roles) ? configured.roles.map(String) : DEFAULT_IMPLEMENTATION_TEAM.roles;
  const roles = configuredRoles.filter(role => IMPLEMENTATION_SPECIALIST_ROLES[role]);
  return {
    enabled: configured.enabled !== false,
    maxSpecialistsPerIteration: normalizePositiveInteger(
      configured.maxSpecialistsPerIteration,
      DEFAULT_IMPLEMENTATION_TEAM.maxSpecialistsPerIteration,
    ),
    memoHistory: normalizePositiveInteger(configured.memoHistory, DEFAULT_IMPLEMENTATION_TEAM.memoHistory),
    roles: roles.length > 0 ? roles : [...DEFAULT_IMPLEMENTATION_TEAM.roles],
  };
}

export function normalizeImplementationBudget(implConfig = {}) {
  return {
    maxIterations: normalizePositiveInteger(implConfig.maxIterations, DEFAULT_IMPLEMENTATION_BUDGET.maxIterations),
    maxDurationMs: normalizePositiveInteger(implConfig.maxDurationMs, DEFAULT_IMPLEMENTATION_BUDGET.maxDurationMs),
    stagnationThreshold: normalizePositiveInteger(
      implConfig.stagnationThreshold,
      DEFAULT_IMPLEMENTATION_BUDGET.stagnationThreshold,
    ),
  };
}

export function createImplementationThread({
  provider = null,
  model = null,
  team,
  budget,
}) {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    provider,
    model,
    team: team || normalizeImplementationTeam(),
    budget: budget || normalizeImplementationBudget(),
    stagnation_streak: 0,
    attempts: [],
    last_run: null,
    active_strategy: null,
  };
}

export function readImplementationThread(cwd) {
  const file = implementationThreadPath(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function writeImplementationThread(cwd, thread) {
  const file = implementationThreadPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(thread, null, 2));
  return file;
}

function normalizeGroup(group = {}) {
  return {
    kind: group.kind || group.type || null,
    label: group.label || group.kind || group.type || "unknown",
    ok: Boolean(group.ok),
    skipped: Boolean(group.skipped),
    passed: Number(group.passed || 0),
    failed: Number(group.failed || 0),
    advisory_failed: Number(group.advisory_failed || 0),
  };
}

export function summarizeVerificationRun(run) {
  if (!run || typeof run !== "object") return null;
  const groups = Array.isArray(run.groups) ? run.groups.map(normalizeGroup) : [];
  const failingGroups = groups.filter(group => !group.ok && !group.skipped);
  const passingGroups = groups.filter(group => group.ok && !group.skipped);
  return {
    ok: Boolean(run.ok),
    passed: Number(run.passed || 0),
    failed: Number(run.failed || 0),
    advisory_failed: Number(run.advisory_failed || 0),
    skipped: Number(run.skipped || 0),
    groups,
    failing_groups: failingGroups,
    passing_groups: passingGroups,
  };
}

function groupKey(group) {
  return `${group.kind || "unknown"}:${group.label || "unknown"}`;
}

export function compareVerificationProgress(previousRun, currentRun) {
  if (!currentRun) {
    return {
      improved: false,
      stagnated: false,
      passed_delta: 0,
      failed_delta: 0,
      newly_passing_groups: [],
      persistent_failures: [],
    };
  }

  if (!previousRun) {
    return {
      improved: currentRun.ok,
      stagnated: false,
      passed_delta: currentRun.passed,
      failed_delta: currentRun.failed,
      newly_passing_groups: [],
      persistent_failures: currentRun.failing_groups.map(group => group.label),
    };
  }

  const previousFailing = new Map(previousRun.failing_groups.map(group => [groupKey(group), group]));
  const currentFailing = new Map(currentRun.failing_groups.map(group => [groupKey(group), group]));
  const newlyPassingGroups = [...previousFailing.keys()]
    .filter(key => !currentFailing.has(key))
    .map(key => previousFailing.get(key)?.label || key);
  const persistentFailures = [...currentFailing.keys()]
    .filter(key => previousFailing.has(key))
    .map(key => currentFailing.get(key)?.label || key);
  const passedDelta = currentRun.passed - previousRun.passed;
  const failedDelta = currentRun.failed - previousRun.failed;
  const improved = Boolean(
    currentRun.ok
    || passedDelta > 0
    || failedDelta < 0
    || newlyPassingGroups.length > 0
  );

  return {
    improved,
    stagnated: !improved,
    passed_delta: passedDelta,
    failed_delta: failedDelta,
    newly_passing_groups: newlyPassingGroups,
    persistent_failures: persistentFailures,
  };
}

export function recordImplementationAttempt(thread, attempt, teamConfig = normalizeImplementationTeam()) {
  const previousRun = summarizeVerificationRun(thread?.last_run);
  const currentRun = summarizeVerificationRun(attempt?.verify_run);
  const progress = compareVerificationProgress(previousRun, currentRun);
  const stagnationStreak = progress.stagnated
    ? Number(thread?.stagnation_streak || 0) + 1
    : 0;
  const attempts = [...(Array.isArray(thread?.attempts) ? thread.attempts : []), {
    iteration: attempt.iteration,
    started_at: new Date().toISOString(),
    written_files: Array.isArray(attempt.written_files) ? attempt.written_files.slice(0, 24) : [],
    strategy: attempt.strategy ? {
      summary: attempt.strategy.summary || "",
      approach: attempt.strategy.approach || "",
      changed_approach: Boolean(attempt.strategy.changed_approach),
      root_causes: Array.isArray(attempt.strategy.root_causes) ? attempt.strategy.root_causes.slice(0, 8) : [],
      assignments: Array.isArray(attempt.strategy.assignments)
        ? attempt.strategy.assignments.map(item => ({
            role: item.role,
            goal: item.goal || "",
            why_now: item.why_now || "",
            focus_types: Array.isArray(item.focus_types) ? item.focus_types.slice(0, 6) : [],
          }))
        : [],
    } : null,
    specialists: Array.isArray(attempt.specialists)
      ? attempt.specialists.map(item => ({
          role: item.role,
          status: item.status || (Array.isArray(item.written_files) && item.written_files.length > 0 ? "wrote" : "idle"),
          written_files: Array.isArray(item.written_files) ? item.written_files.slice(0, 12) : [],
          blocked_summary: item.blocker_report?.summary || "",
          handoff_role: item.blocker_report?.handoff_role || null,
        }))
      : [],
    verify_run: currentRun,
    progress,
  }];
  const boundedAttempts = attempts.slice(-Math.max(1, teamConfig.memoHistory));
  return {
    ...(thread || createImplementationThread({ team: teamConfig })),
    updated_at: new Date().toISOString(),
    stagnation_streak: stagnationStreak,
    attempts: boundedAttempts,
    last_run: attempt.verify_run || null,
    active_strategy: attempt.strategy || null,
  };
}

export function buildImplementationMemo(thread, limit = 4) {
  if (!thread || !Array.isArray(thread.attempts) || thread.attempts.length === 0) {
    return {
      stagnation_streak: Number(thread?.stagnation_streak || 0),
      recent_attempts: [],
      last_strategy: null,
    };
  }
  const recent = thread.attempts.slice(-Math.max(1, limit)).map(attempt => ({
    iteration: attempt.iteration,
    written_files: Array.isArray(attempt.written_files) ? attempt.written_files.slice(0, 12) : [],
    strategy: attempt.strategy
      ? {
          approach: attempt.strategy.approach || "",
          changed_approach: Boolean(attempt.strategy.changed_approach),
          assignments: Array.isArray(attempt.strategy.assignments)
            ? attempt.strategy.assignments.map(item => ({
                role: item.role,
                goal: item.goal || "",
              }))
            : [],
        }
      : null,
    specialists: Array.isArray(attempt.specialists)
      ? attempt.specialists.map(item => ({
          role: item.role,
          status: item.status || (Array.isArray(item.written_files) && item.written_files.length > 0 ? "wrote" : "idle"),
          blocked_summary: item.blocker_report?.summary || "",
          handoff_role: item.blocker_report?.handoff_role || null,
        }))
      : [],
    progress: attempt.progress || null,
    verify: attempt.verify_run
      ? {
          ok: Boolean(attempt.verify_run.ok),
          passed: Number(attempt.verify_run.passed || 0),
          failed: Number(attempt.verify_run.failed || 0),
          failing_groups: Array.isArray(attempt.verify_run.failing_groups)
            ? attempt.verify_run.failing_groups.map(group => group.label)
            : [],
        }
      : null,
  }));
  return {
    stagnation_streak: Number(thread.stagnation_streak || 0),
    recent_attempts: recent,
    last_strategy: recent.at(-1)?.strategy || null,
  };
}

function uniqueAssignments(assignments, teamConfig) {
  const roles = new Set();
  const result = [];
  for (const assignment of assignments) {
    if (!assignment?.role || roles.has(assignment.role)) continue;
    if (!teamConfig.roles.includes(assignment.role)) continue;
    roles.add(assignment.role);
    result.push(assignment);
    if (result.length >= teamConfig.maxSpecialistsPerIteration) break;
  }
  return result;
}

function evidenceFileForType(type) {
  if (type === "ui") return "evidence/ui.json";
  if (type === "behavior" || type === "behavior_gherkin") return "evidence/behavior.json";
  if (type === "api") return "evidence/api.json";
  if (type === "db") return "evidence/database.json";
  if (type === "domain") return "evidence/domain.json";
  if (type === "security") return "evidence/security.json";
  if (type === "technical") return "evidence/technical.json";
  if (type === "nfr") return "evidence/load.json";
  return "evidence/run.json";
}

export function fallbackStrategyAssignments({ run, team, verificationTypes = [] }) {
  const teamConfig = team || normalizeImplementationTeam();
  const failingGroups = Array.isArray(run?.failing_groups) ? run.failing_groups : [];
  const roles = [];
  const roleForGroupKind = {
    ui: "ui",
    behavior: "ui",
    behavior_gherkin: "api",
    api: "api",
    db: "database",
    domain: "database",
    security: "security",
    technical: "technical",
    nfr: "technical",
  };

  for (const group of failingGroups) {
    const role = roleForGroupKind[group.kind] || "architecture";
    roles.push(role);
  }
  if (roles.length === 0) {
    for (const type of verificationTypes) {
      const role = roleForGroupKind[type] || "architecture";
      roles.push(role);
    }
  }
  if (roles.length > 1) roles.unshift("architecture");
  if (roles.length === 0) roles.push("architecture", "technical");

  const assignments = uniqueAssignments(
    roles.map(role => ({
      role,
      goal: `Fix the ${role} root causes blocking the next verification run.`,
      why_now: "This specialist covers the currently failing surface.",
      focus_types: failingGroups
        .filter(group => roleForGroupKind[group.kind] === role)
        .map(group => group.kind)
        .filter(Boolean),
      instructions: [],
    })),
    teamConfig,
  ).map(assignment => {
    const focusTypes = assignment.focus_types.length > 0
      ? assignment.focus_types
      : verificationTypes.filter(type => roleForGroupKind[type] === assignment.role);
    const targetGroups = focusTypes.length > 0 ? focusTypes : [assignment.role];
    return {
      ...assignment,
      focus_types: focusTypes,
      target_groups: targetGroups,
      target_evidence: [...new Set(["evidence/run.json", ...targetGroups.map(evidenceFileForType)])],
    };
  });

  return {
    summary: "Fallback specialist routing based on the latest failing verification groups.",
    approach: "Target the failing verification surfaces directly and repair the underlying root causes.",
    changed_approach: false,
    root_causes: [],
    assignments,
  };
}
