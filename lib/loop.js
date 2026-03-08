import fs from "node:fs";
import path from "node:path";
import { gen } from "./gen.js";
import { loadManifest } from "./gen.js";
import { verify } from "./verify.js";
import { impl } from "./impl.js";
import { readConfig } from "./config.js";
import { buildDoctor } from "./doctor.js";
import { runLint } from "./lint.js";

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

function writeImplementationEvidence(cwd, report) {
  const evidDir = path.join(cwd, "evidence");
  fs.mkdirSync(evidDir, { recursive: true });
  fs.writeFileSync(path.join(evidDir, "implement.json"), JSON.stringify(report, null, 2));
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
  const startedAt = Date.now();
  const resolvedProvider = provider || process.env.SHIPFLOW_IMPL_PROVIDER || config.impl?.provider || "anthropic";
  const resolvedModel = model || process.env.SHIPFLOW_IMPL_MODEL || config.impl?.model || config.models?.impl || null;
  const vpCounts = countVerificationPack(cwd);
  const attempts = [];

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
    }));
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
    }));
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
      }));
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
  }));
  return 1;
}
