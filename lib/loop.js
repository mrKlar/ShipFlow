import fs from "node:fs";
import path from "node:path";
import { gen } from "./gen.js";
import { loadManifest } from "./gen.js";
import { verify } from "./verify.js";
import { impl, resolveImplOptions } from "./impl.js";
import { readConfig } from "./config.js";
import { buildDoctor } from "./doctor.js";
import { runLint } from "./lint.js";
import { collectStatus } from "./status.js";

function printIssues(title, issues) {
  console.log(`\n=== ShipFlow implement: ${title} ===\n`);
  for (const issue of issues) {
    console.log(`- ${issue}`);
  }
}

function countYaml(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(file => file.endsWith(".yml") || file.endsWith(".yaml")).length;
}

export function countVerificationPack(cwd) {
  const vpDir = path.join(cwd, "vp");
  return {
    ui: countYaml(path.join(vpDir, "ui")),
    behavior: countYaml(path.join(vpDir, "behavior")),
    api: countYaml(path.join(vpDir, "api")),
    database: countYaml(path.join(vpDir, "db")),
    performance: countYaml(path.join(vpDir, "nfr")),
    security: countYaml(path.join(vpDir, "security")),
    technical: countYaml(path.join(vpDir, "technical")),
  };
}

function manifestCounts(cwd) {
  const manifest = loadManifest(cwd);
  if (!manifest?.outputs) return {};
  return Object.fromEntries(
    Object.entries(manifest.outputs).map(([key, value]) => [key, value.count || 0]),
  );
}

function compactImplementationReport(report) {
  return {
    started_at: report.started_at,
    duration_ms: report.duration_ms,
    stage: report.stage,
    ok: report.ok,
    exit_code: report.exit_code,
    iterations: report.iterations,
    first_pass_success: report.first_pass_success,
    retries_used: report.retries_used,
    provider: report.provider,
    model: report.model,
    doctor_ok: report.doctor_ok,
    lint_ok: report.lint_ok,
    vp_counts: report.vp_counts,
    generated_counts: report.generated_counts,
  };
}

export function summarizeImplementationHistory(runs = []) {
  const totalRuns = runs.length;
  const passedRuns = runs.filter(run => run.ok).length;
  const failedRuns = totalRuns - passedRuns;
  const firstPassRuns = runs.filter(run => run.first_pass_success).length;
  const totalIterations = runs.reduce((sum, run) => sum + (run.iterations || 0), 0);
  const totalDuration = runs.reduce((sum, run) => sum + (run.duration_ms || 0), 0);
  const lastSuccess = [...runs].reverse().find(run => run.ok);
  const lastFailure = [...runs].reverse().find(run => !run.ok);
  const byProvider = Object.fromEntries(
    [...runs.reduce((map, run) => {
      const provider = run.provider || "unknown";
      map.set(provider, (map.get(provider) || 0) + 1);
      return map;
    }, new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0])),
  );

  return {
    total_runs: totalRuns,
    passed_runs: passedRuns,
    failed_runs: failedRuns,
    pass_rate: totalRuns === 0 ? 0 : Number((passedRuns / totalRuns).toFixed(3)),
    first_pass_rate: totalRuns === 0 ? 0 : Number((firstPassRuns / totalRuns).toFixed(3)),
    average_iterations: totalRuns === 0 ? 0 : Number((totalIterations / totalRuns).toFixed(2)),
    average_duration_ms: totalRuns === 0 ? 0 : Math.round(totalDuration / totalRuns),
    last_success_at: lastSuccess?.started_at || null,
    last_failure_at: lastFailure?.started_at || null,
    by_provider: byProvider,
  };
}

export function writeImplementationHistory(cwd, report, limit = 50) {
  const evidDir = path.join(cwd, "evidence");
  fs.mkdirSync(evidDir, { recursive: true });
  const file = path.join(evidDir, "implement-history.json");

  let runs = [];
  if (fs.existsSync(file)) {
    try {
      const current = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (Array.isArray(current.runs)) runs = current.runs;
    } catch {
      runs = [];
    }
  }

  const nextRuns = [...runs, compactImplementationReport(report)].slice(-Math.max(1, limit));
  const history = {
    version: 1,
    updated_at: new Date().toISOString(),
    limit: Math.max(1, limit),
    summary: summarizeImplementationHistory(nextRuns),
    runs: nextRuns,
  };
  fs.writeFileSync(file, JSON.stringify(history, null, 2));
  return history;
}

function writeImplementationEvidence(cwd, report, historyLimit = 50) {
  const evidDir = path.join(cwd, "evidence");
  fs.mkdirSync(evidDir, { recursive: true });
  fs.writeFileSync(path.join(evidDir, "implement.json"), JSON.stringify(report, null, 2));
  writeImplementationHistory(cwd, report, historyLimit);
}

export function buildImplementationReport({
  startedAt,
  stage,
  ok,
  exitCode,
  iterations,
  provider,
  model,
  vpCounts,
  generatedCounts,
  attempts = [],
  doctorOk = true,
  lintOk = true,
}) {
  return {
    version: 1,
    started_at: new Date(startedAt).toISOString(),
    duration_ms: Date.now() - startedAt,
    stage,
    ok,
    exit_code: exitCode,
    iterations,
    first_pass_success: ok && iterations === 1,
    retries_used: Math.max(0, iterations - 1),
    provider: provider || null,
    model: model || null,
    doctor_ok: doctorOk,
    lint_ok: lintOk,
    vp_counts: vpCounts,
    generated_counts: generatedCounts,
    attempts,
  };
}

export async function run({ cwd, provider, model }) {
  const config = readConfig(cwd);
  const maxIterations = config.impl?.maxIterations || 5;
  const historyLimit = config.impl?.historyLimit || 50;
  const startedAt = Date.now();
  const resolvedOptions = resolveImplOptions(cwd, { provider, model });
  const resolvedProvider = resolvedOptions.provider;
  const resolvedModel = resolvedOptions.model || null;
  const vpCounts = countVerificationPack(cwd);
  const attempts = [];
  const currentStatus = collectStatus(cwd);

  if (currentStatus.draft_session && !currentStatus.draft_session.ready_for_implement) {
    const issues = [
      ...(currentStatus.draft_session.blocking_reasons || []),
      "Review the draft session, then run shipflow draft --write once the accepted proposals are final.",
    ];
    printIssues("draft review is still in progress", issues);
    writeImplementationEvidence(cwd, buildImplementationReport({
      startedAt,
      stage: "draft",
      ok: false,
      exitCode: 1,
      iterations: 0,
      provider: resolvedProvider,
      model: resolvedModel,
      vpCounts,
      generatedCounts: {},
      attempts,
      doctorOk: true,
      lintOk: true,
    }), historyLimit);
    return 1;
  }

  const doctor = buildDoctor(cwd);
  if (!doctor.ok) {
    printIssues("environment not ready", doctor.issues);
    writeImplementationEvidence(cwd, buildImplementationReport({
      startedAt,
      stage: "doctor",
      ok: false,
      exitCode: 1,
      iterations: 0,
      provider: resolvedProvider,
      model: resolvedModel,
      vpCounts,
      generatedCounts: {},
      attempts,
      doctorOk: false,
      lintOk: true,
    }), historyLimit);
    return 1;
  }

  const lint = runLint(cwd);
  if (!lint.ok) {
    printIssues("verification pack needs fixes", lint.issues.map(issue => `${issue.file} ${issue.code}: ${issue.message}`));
    writeImplementationEvidence(cwd, buildImplementationReport({
      startedAt,
      stage: "lint",
      ok: false,
      exitCode: 1,
      iterations: 0,
      provider: resolvedProvider,
      model: resolvedModel,
      vpCounts,
      generatedCounts: {},
      attempts,
      doctorOk: true,
      lintOk: false,
    }), historyLimit);
    return 1;
  }

  console.log("=== ShipFlow implement: compiling verifications ===\n");
  await gen({ cwd });
  const generatedCounts = manifestCounts(cwd);

  let errors = null;

  for (let i = 1; i <= maxIterations; i++) {
    console.log(`\n=== ShipFlow implement: iteration ${i}/${maxIterations} — apply code ===\n`);
    await impl({ cwd, errors, provider, model });

    console.log(`\n=== ShipFlow implement: iteration ${i}/${maxIterations} — verify ===\n`);
    const { exitCode, output } = await verify({ cwd, capture: true });
    attempts.push({ iteration: i, verify_exit_code: exitCode, ok: exitCode === 0 });

    if (exitCode === 0) {
      console.log(`\n=== ShipFlow implement: PASS — all checks green (iteration ${i}) ===\n`);
      writeImplementationEvidence(cwd, buildImplementationReport({
        startedAt,
        stage: "verify",
        ok: true,
        exitCode: 0,
        iterations: i,
        provider: resolvedProvider,
        model: resolvedModel,
        vpCounts,
        generatedCounts,
        attempts,
      }), historyLimit);
      return 0;
    }

    errors = output;
    console.log(`\n=== ShipFlow implement: FAIL — iteration ${i}, ${maxIterations - i} retries left ===\n`);
  }

  console.error(`\n=== ShipFlow implement: FAILED after ${maxIterations} iterations ===\n`);
  writeImplementationEvidence(cwd, buildImplementationReport({
    startedAt,
    stage: "verify",
    ok: false,
    exitCode: 1,
    iterations: maxIterations,
    provider: resolvedProvider,
    model: resolvedModel,
    vpCounts,
    generatedCounts,
    attempts,
  }), historyLimit);
  return 1;
}
