import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirp, listFilesRec, writeFile } from "./util/fs.js";
import { readUiFixtures, locatorExpr, genStep, assertExpr, genPlaywrightTest, readUiChecks } from "./gen-ui.js";
import { VERIFICATION_REGISTRY } from "./verification-registry.js";
import { buildVerificationLock } from "./util/verification-lock.js";

export { locatorExpr, genStep, assertExpr, genPlaywrightTest, readUiChecks, readUiFixtures };

const GENERATED_PLAYWRIGHT_CONFIG = ".gen/playwright.config.mjs";

function buildVpLock(cwd, vpDir, genDir) {
  const lock = buildVerificationLock(cwd, { vpDir, genDir });
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
  if (kind === "technical") {
    if (artifact.kind === "technical-runner") {
      if (!content.includes("ShipFlow technical backend")) return { ok: false, reason: "missing technical backend banner" };
      if (!content.includes("runFrameworkBackend")) return { ok: false, reason: "missing framework backend runner" };
      if (!content.includes("runGenericAssertions")) return { ok: false, reason: "missing generic assertions runner" };
      return { ok: true };
    }
    if (artifact.kind === "technical-config") {
      if (!content.trim()) return { ok: false, reason: "empty technical config" };
      return { ok: true };
    }
  }
  if (kind === "domain") {
    if (artifact.kind === "domain-runner") {
      if (!content.includes("ShipFlow business-domain backend")) return { ok: false, reason: "missing business-domain backend banner" };
      if (!content.includes("data engineering section")) return { ok: false, reason: "missing business-domain data engineering validation" };
      return { ok: true };
    }
  }
  return { ok: true };
}

function parseUrlSafe(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalRuntimeUrl(value) {
  const parsed = parseUrlSafe(value);
  if (!parsed) return false;
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname);
}

function collectPlaywrightBaseUrls(entry, checks) {
  if (entry.output_kind !== "playwright") return [];
  return checks
    .map(check => typeof check?.app?.base_url === "string" ? check.app.base_url : null)
    .filter(Boolean);
}

function buildGeneratedPlaywrightConfig(baseUrls) {
  const primaryBaseUrl = baseUrls.find(isLocalRuntimeUrl) || baseUrls[0] || "http://localhost:3000";

  return [
    'import { defineConfig } from "@playwright/test";',
    "",
    `const baseURL = process.env.SHIPFLOW_BASE_URL || ${JSON.stringify(primaryBaseUrl)};`,
    'const webServerCommand = process.env.SHIPFLOW_WEB_SERVER_COMMAND || "npm run dev";',
    `const shouldStartWebServer = ${baseUrls.some(isLocalRuntimeUrl)} || Boolean(process.env.SHIPFLOW_WEB_SERVER_COMMAND);`,
    'const workers = Number(process.env.SHIPFLOW_PLAYWRIGHT_WORKERS || "1");',
    "",
    "export default defineConfig({",
    '  testDir: "./playwright",',
    "  workers: Number.isFinite(workers) && workers > 0 ? workers : 1,",
    "  use: {",
    "    baseURL,",
    "  },",
    "  ...(shouldStartWebServer ? {",
    "    webServer: {",
    "      command: webServerCommand,",
    "      url: baseURL,",
    "      reuseExistingServer: true,",
    "      timeout: 120000,",
    "    },",
    "  } : {}),",
    "});",
    "",
  ].join("\n");
}

function writeGeneratedPlaywrightConfig(cwd, genDir, baseUrls, validations) {
  const configPath = path.join(genDir, "playwright.config.mjs");
  if (baseUrls.length === 0) {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    return null;
  }
  const content = buildGeneratedPlaywrightConfig(baseUrls);
  writeFile(configPath, content);
  validations.structural.push({
    type: "playwright-runtime",
    file: GENERATED_PLAYWRIGHT_CONFIG,
    ok: true,
  });
  return configPath;
}

function canSmokeCompilePlaywright(cwd) {
  const probe = spawnSync("node", ["-e", "import('@playwright/test').then(()=>process.exit(0)).catch(()=>process.exit(1))"], {
    cwd,
    stdio: "pipe",
  });
  return probe.status === 0;
}

function maybeSmokeCompilePlaywright(cwd, files, configPath) {
  if (files.length === 0) return { status: "skipped", reason: "no_playwright_files" };
  if (!canSmokeCompilePlaywright(cwd)) return { status: "skipped", reason: "@playwright/test not installed" };
  const relFiles = files.map(file => path.relative(cwd, file).replaceAll("\\", "/"));
  const relConfig = configPath ? path.relative(cwd, configPath).replaceAll("\\", "/") : null;
  const args = ["playwright", "test"];
  if (relConfig) args.push("--config", relConfig);
  args.push("--list", "--reporter=line", ...relFiles);
  const result = spawnSync("npx", args, {
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
  const playwrightBaseUrls = [];

  for (const entry of VERIFICATION_REGISTRY) {
    const outDir = path.join(genDir, entry.output_dir);
    mkdirp(outDir);

    const checks = entry.readChecks(vpDir).filter(check => entry.filter ? entry.filter(check, context) : true);
    playwrightBaseUrls.push(...collectPlaywrightBaseUrls(entry, checks));
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

  const generatedPlaywrightConfig = writeGeneratedPlaywrightConfig(cwd, genDir, uniq(playwrightBaseUrls), validations);

  const playwrightFiles = VERIFICATION_REGISTRY
    .filter(entry => entry.output_kind === "playwright")
    .flatMap(entry => outputs[entry.id]?.files || [])
    .map(rel => path.join(cwd, rel));

  const smokePlaywright = maybeSmokeCompilePlaywright(cwd, playwrightFiles, generatedPlaywrightConfig);
  validations.smoke_compile.push({ target: "playwright", ...smokePlaywright });

  writeManifest(cwd, genDir, outputs, validations);
  buildVpLock(cwd, vpDir, genDir);

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
