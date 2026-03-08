import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { mkdirp, listFilesRec, writeFile } from "./util/fs.js";
import { sha256 } from "./util/hash.js";
import { UiCheck, UiFixture } from "./schema/ui-check.zod.js";
import { readBehaviorChecks, genBehaviorTest } from "./gen-behavior.js";
import { readApiChecks, genApiTest } from "./gen-api.js";
import { readDbChecks, genDbTest } from "./gen-db.js";
import { readNfrChecks, genK6Script } from "./gen-nfr.js";

// --- locator & codegen helpers (exported for testing) ---

export function locatorExpr(loc) {
  if (loc.testid) return `page.getByTestId(${JSON.stringify(loc.testid)})`;
  if (loc.label) return `page.getByLabel(${JSON.stringify(loc.label)})`;
  const role = loc.role;
  const name = loc.name;
  if (loc.name_regex) return `page.getByRole(${JSON.stringify(role)}, { name: new RegExp(${JSON.stringify(name)}) })`;
  return `page.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)} })`;
}

export function genStep(step, baseUrl) {
  if (step.open) return `await page.goto(${JSON.stringify(baseUrl + step.open)});`;
  if (step.click) return `await ${locatorExpr(step.click)}.click();`;
  if (step.fill) return `await ${locatorExpr(step.fill)}.fill(${JSON.stringify(step.fill.value)});`;
  if (step.select) return `await ${locatorExpr(step.select)}.selectOption(${JSON.stringify(step.select.value)});`;
  if (step.hover) return `await ${locatorExpr(step.hover)}.hover();`;
  if (step.wait_for) return `await page.waitForTimeout(${step.wait_for.ms ?? 250});`;
  throw new Error("Unknown step");
}

export function assertExpr(a) {
  if (a.text_equals) {
    const { testid, equals } = a.text_equals;
    return `await expect(page.getByTestId(${JSON.stringify(testid)})).toHaveText(${JSON.stringify(equals)});`;
  }
  if (a.text_matches) {
    const { testid, regex } = a.text_matches;
    return `await expect(page.getByTestId(${JSON.stringify(testid)})).toHaveText(new RegExp(${JSON.stringify(regex)}));`;
  }
  if (a.visible) {
    return `await expect(page.getByTestId(${JSON.stringify(a.visible.testid)})).toBeVisible();`;
  }
  if (a.hidden) {
    return `await expect(page.getByTestId(${JSON.stringify(a.hidden.testid)})).toBeHidden();`;
  }
  if (a.url_matches) {
    return `await expect(page).toHaveURL(new RegExp(${JSON.stringify(a.url_matches.regex)}));`;
  }
  if (a.count) {
    return `await expect(page.getByTestId(${JSON.stringify(a.count.testid)})).toHaveCount(${a.count.equals});`;
  }
  throw new Error("Unknown assert");
}

export function genPlaywrightTest(check, fixturesMap) {
  const baseUrl = check.app.base_url;
  const title = `${check.id}: ${check.title}`;
  const L = [];
  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(``);
  L.push(`test(${JSON.stringify(title)}, async ({ page }) => {`);
  L.push(`  await page.goto(${JSON.stringify(baseUrl)});`);

  if (check.setup) {
    const fixture = fixturesMap?.get(check.setup);
    if (!fixture) throw new Error(`Unknown fixture "${check.setup}" referenced in ${check.id}`);
    L.push(`  // setup: ${check.setup}`);
    for (const step of fixture.flow) {
      L.push(`  ${genStep(step, baseUrl)}`);
    }
  }

  for (const step of check.flow) {
    L.push(`  ${genStep(step, baseUrl)}`);
  }
  for (const a of check.assert) L.push(`  ${assertExpr(a)}`);
  L.push(`});`);
  L.push(``);
  return L.join("\n");
}

// --- readers ---

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

function readUiFixtures(vpDir) {
  const fixturesDir = path.join(vpDir, "ui", "_fixtures");
  if (!fs.existsSync(fixturesDir)) return [];
  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(fixturesDir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      return UiFixture.parse(raw);
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/ui/_fixtures/${f}`, err);
      throw err;
    }
  });
}

function readUiChecks(vpDir) {
  const uiDir = path.join(vpDir, "ui");
  if (!fs.existsSync(uiDir)) return [];
  const files = fs.readdirSync(uiDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(uiDir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = UiCheck.parse(raw);
      parsed.__file = `vp/ui/${f}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/ui/${f}`, err);
      throw err;
    }
  });
}

// --- lock ---

function buildVpLock(cwd, vpDir, genDir) {
  const files = listFilesRec(vpDir).filter(p => !p.includes(`${path.sep}.DS_Store`));
  const items = files.map(p => {
    const rel = path.relative(cwd, p).replaceAll("\\", "/");
    const buf = fs.readFileSync(p);
    return { path: rel, sha256: sha256(buf) };
  }).sort((a,b) => a.path.localeCompare(b.path));

  const lock = {
    version: 1,
    created_at: new Date().toISOString(),
    vp_sha256: sha256(Buffer.from(JSON.stringify(items))),
    files: items
  };
  writeFile(path.join(genDir, "vp.lock.json"), JSON.stringify(lock, null, 2));
}

// --- main ---

function genOutName(file) {
  return file.replaceAll("/", "_").replace(".yml", ".test.ts").replace(".yaml", ".test.ts");
}

export async function gen({ cwd }) {
  const vpDir = path.join(cwd, "vp");
  const genDir = path.join(cwd, ".gen");
  const outDir = path.join(genDir, "playwright");
  mkdirp(outDir);

  const fixtures = readUiFixtures(vpDir);
  const fixturesMap = new Map(fixtures.map(f => [f.id, f]));

  // UI checks
  const uiChecks = readUiChecks(vpDir);
  for (const check of uiChecks) {
    writeFile(path.join(outDir, genOutName(check.__file)), genPlaywrightTest(check, fixturesMap));
  }

  // Behavior checks (Gherkin-style given/when/then)
  const behaviorChecks = readBehaviorChecks(vpDir);
  for (const check of behaviorChecks) {
    writeFile(path.join(outDir, genOutName(check.__file)), genBehaviorTest(check, fixturesMap));
  }

  // API checks
  const apiChecks = readApiChecks(vpDir);
  for (const check of apiChecks) {
    writeFile(path.join(outDir, genOutName(check.__file)), genApiTest(check));
  }

  // DB checks
  const dbChecks = readDbChecks(vpDir);
  for (const check of dbChecks) {
    writeFile(path.join(outDir, genOutName(check.__file)), genDbTest(check));
  }

  // NFR checks (k6 scripts)
  const nfrChecks = readNfrChecks(vpDir);
  if (nfrChecks.length > 0) {
    const k6Dir = path.join(genDir, "k6");
    mkdirp(k6Dir);
    for (const check of nfrChecks) {
      const name = check.__file.replaceAll("/", "_").replace(".yml", ".js").replace(".yaml", ".js");
      writeFile(path.join(k6Dir, name), genK6Script(check));
    }
  }

  buildVpLock(cwd, vpDir, genDir);

  const parts = [];
  if (uiChecks.length) parts.push(`${uiChecks.length} UI`);
  if (behaviorChecks.length) parts.push(`${behaviorChecks.length} behavior`);
  if (apiChecks.length) parts.push(`${apiChecks.length} API`);
  if (dbChecks.length) parts.push(`${dbChecks.length} DB`);
  if (nfrChecks.length) parts.push(`${nfrChecks.length} NFR`);
  const outputs = [".gen/playwright"];
  if (nfrChecks.length) outputs.push(".gen/k6");
  outputs.push("vp.lock.json");
  console.log(`ShipFlow gen: ${parts.join(" + ")} checks -> ${outputs.join(" + ")}`);
}
