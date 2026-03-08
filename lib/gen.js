import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirp, listFilesRec, writeFile } from "./util/fs.js";
import { sha256 } from "./util/hash.js";
import { readUiFixtures, locatorExpr, genStep, assertExpr, genPlaywrightTest, readUiChecks } from "./gen-ui.js";
import { VERIFICATION_REGISTRY } from "./verification-registry.js";

export { locatorExpr, genStep, assertExpr, genPlaywrightTest, readUiChecks, readUiFixtures };

function buildVpLock(cwd, vpDir, genDir) {
  const files = listFilesRec(vpDir).filter(p => !p.includes(`${path.sep}.DS_Store`));
  const items = files.map(p => {
    const rel = path.relative(cwd, p).replaceAll("\\", "/");
    const buf = fs.readFileSync(p);
    return { path: rel, sha256: sha256(buf) };
  }).sort((a, b) => a.path.localeCompare(b.path));

  const lock = {
    version: 1,
    created_at: new Date().toISOString(),
    vp_sha256: sha256(Buffer.from(JSON.stringify(items))),
    files: items,
  };
  writeFile(path.join(genDir, "vp.lock.json"), JSON.stringify(lock, null, 2));
}

function pruneGeneratedFiles(dir, expected) {
  if (!fs.existsSync(dir)) return;
  for (const full of listFilesRec(dir)) {
    const rel = path.relative(dir, full).replaceAll("\\", "/");
    if (!expected.has(rel)) fs.unlinkSync(full);
  }
  pruneEmptyDirs(dir);
}

function pruneEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    pruneEmptyDirs(full);
    if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
  }
}

function structuralValidation(kind, content, artifact = {}) {
  if (!content.trim()) return { ok: false, reason: "empty file" };
  if (kind === "playwright") {
    if (!content.includes('import { test, expect } from "@playwright/test"')) return { ok: false, reason: "missing Playwright import" };
    if (!content.includes("test(") && !content.includes("test.describe(")) return { ok: false, reason: "missing test declaration" };
    return { ok: true };
  }
  if (kind === "k6") {
    if (!content.includes('import http from "k6/http"')) return { ok: false, reason: "missing k6 import" };
    if (!content.includes("export default function")) return { ok: false, reason: "missing default entrypoint" };
    return { ok: true };
  }
  if (kind === "cucumber") {
    if (artifact.kind === "cucumber-feature") {
      if (!content.includes("Feature:")) return { ok: false, reason: "missing Feature declaration" };
      if (!content.includes("Scenario:")) return { ok: false, reason: "missing Scenario declaration" };
      return { ok: true };
    }
    if (artifact.kind === "cucumber-steps") {
      if (!content.includes('@cucumber/cucumber')) return { ok: false, reason: "missing Cucumber import" };
      if (!content.includes("Given(") && !content.includes("When(") && !content.includes("Then(")) {
        return { ok: false, reason: "missing step definitions" };
      }
      return { ok: true };
    }
  }
  return { ok: true };
}

function canSmokeCompilePlaywright(cwd) {
  const probe = spawnSync("node", ["-e", "import('@playwright/test').then(()=>process.exit(0)).catch(()=>process.exit(1))"], {
    cwd,
    stdio: "pipe",
  });
  return probe.status === 0;
}

function maybeSmokeCompilePlaywright(cwd, files) {
  if (files.length === 0) return { status: "skipped", reason: "no_playwright_files" };
  if (!canSmokeCompilePlaywright(cwd)) return { status: "skipped", reason: "@playwright/test not installed" };
  const relFiles = files.map(file => path.relative(cwd, file).replaceAll("\\", "/"));
  const result = spawnSync("npx", ["playwright", "test", "--list", "--reporter=line", ...relFiles], {
    cwd,
    stdio: "pipe",
  });
  return {
    status: result.status === 0 ? "ok" : "failed",
    exit_code: result.status ?? 1,
    output: ((result.stdout?.toString() || "") + (result.stderr?.toString() || "")).trim(),
  };
}

function writeManifest(cwd, genDir, outputs, validations) {
  const manifest = {
    version: 1,
    created_at: new Date().toISOString(),
    outputs,
    validations,
  };
  writeFile(path.join(genDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

export function loadManifest(cwd) {
  const manifestPath = path.join(cwd, ".gen", "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

function normalizeGeneratedArtifacts(entry, check, context) {
  if (typeof entry.generateArtifacts === "function") {
    return entry.generateArtifacts(check, context);
  }
  return [{
    name: entry.outputName(check),
    content: entry.generate(check, context),
    kind: entry.output_kind,
    primary: true,
  }];
}

export async function gen({ cwd }) {
  const vpDir = path.join(cwd, "vp");
  const genDir = path.join(cwd, ".gen");
  mkdirp(genDir);

  const fixtures = readUiFixtures(vpDir);
  const fixturesMap = new Map(fixtures.map(f => [f.id, f]));
  const context = { cwd, vpDir, genDir, fixtures, fixturesMap };

  const outputs = {};
  const expectedByDir = new Map();
  const validations = {
    structural: [],
    smoke_compile: [],
  };

  for (const entry of VERIFICATION_REGISTRY) {
    const outDir = path.join(genDir, entry.output_dir);
    mkdirp(outDir);

    const checks = entry.readChecks(vpDir).filter(check => entry.filter ? entry.filter(check, context) : true);
    const files = [];
    const generatedChecks = [];
    const expected = expectedByDir.get(outDir) || new Set();

    for (const check of checks) {
      const artifacts = normalizeGeneratedArtifacts(entry, check, context);
      const relPaths = [];

      for (const artifact of artifacts) {
        const artifactRel = artifact.relative_dir
          ? path.join(artifact.relative_dir, artifact.name)
          : artifact.name;
        const fullPath = path.join(outDir, artifactRel);
        const content = artifact.content;
        const validation = structuralValidation(entry.output_kind, content, artifact);
        if (!validation.ok) {
          throw new Error(`Generated ${entry.output_kind} artifact ${path.relative(cwd, fullPath)} is invalid: ${validation.reason}`);
        }
        expected.add(artifactRel.replaceAll("\\", "/"));
        writeFile(fullPath, content);
        const relPath = path.relative(cwd, fullPath).replaceAll("\\", "/");
        relPaths.push(relPath);
        files.push(relPath);
        validations.structural.push({
          type: entry.id,
          file: relPath,
          ok: true,
        });
      }

      const primaryFile = relPaths[0] || null;
      generatedChecks.push({
        id: check.id,
        title: check.title || check.scenario || check.feature || check.id,
        severity: check.severity || "blocker",
        file: primaryFile,
        companion_files: relPaths.slice(1),
      });
    }

    expectedByDir.set(outDir, expected);
    outputs[entry.id] = {
      label: entry.label,
      output_kind: entry.output_kind,
      output_dir: entry.output_dir,
      evidence_file: entry.evidence_file,
      count: checks.length,
      files,
      checks: generatedChecks,
    };
  }

  for (const [dir, expected] of expectedByDir) {
    pruneGeneratedFiles(dir, expected);
  }

  const playwrightFiles = VERIFICATION_REGISTRY
    .filter(entry => entry.output_kind === "playwright")
    .flatMap(entry => outputs[entry.id]?.files || [])
    .map(rel => path.join(cwd, rel));

  const smokePlaywright = maybeSmokeCompilePlaywright(cwd, playwrightFiles);
  validations.smoke_compile.push({ target: "playwright", ...smokePlaywright });

  buildVpLock(cwd, vpDir, genDir);
  writeManifest(cwd, genDir, outputs, validations);

  const parts = VERIFICATION_REGISTRY
    .filter(entry => (outputs[entry.id]?.count || 0) > 0)
    .map(entry => `${outputs[entry.id].count} ${entry.label.toLowerCase()}`);
  const generatedRoots = uniq(VERIFICATION_REGISTRY.map(entry => `.gen/${entry.output_dir}`));
  const smokeNote = smokePlaywright.status === "ok"
    ? " + playwright smoke compile"
    : smokePlaywright.status === "failed"
      ? " + playwright smoke compile FAILED"
      : "";
  console.log(`ShipFlow gen: ${parts.join(" + ")} checks -> ${generatedRoots.join(" + ")} + .gen/manifest.json + vp.lock.json${smokeNote}`);
}

function uniq(items) {
  return [...new Set(items)];
}
