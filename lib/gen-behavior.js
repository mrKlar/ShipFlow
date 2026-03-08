import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { BehaviorCheck } from "./schema/behavior-check.zod.js";
import { genStep, assertExpr } from "./gen.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

export function readBehaviorChecks(vpDir) {
  const dir = path.join(vpDir, "behavior");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(dir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = BehaviorCheck.parse(raw);
      parsed.__file = `vp/behavior/${f}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/behavior/${f}`, err);
      throw err;
    }
  });
}

export function genBehaviorSpec(check, fixturesMap) {
  const baseUrl = check.app.base_url;
  const L = [];
  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(``);
  L.push(`test.describe(${JSON.stringify(check.feature)}, () => {`);
  L.push(`  test(${JSON.stringify(`${check.id}: ${check.scenario}`)}, async ({ page }) => {`);
  L.push(`    await page.goto(${JSON.stringify(baseUrl)});`);

  if (check.setup) {
    const fixture = fixturesMap?.get(check.setup);
    if (!fixture) throw new Error(`Unknown fixture "${check.setup}" referenced in ${check.id}`);
    L.push(`    // setup: ${check.setup}`);
    for (const step of fixture.flow) {
      L.push(`    ${genStep(step, baseUrl)}`);
    }
  }

  L.push(`    // Given`);
  for (const step of check.given) {
    L.push(`    ${genStep(step, baseUrl)}`);
  }
  L.push(`    // When`);
  for (const step of check.when) {
    L.push(`    ${genStep(step, baseUrl)}`);
  }
  L.push(`    // Then`);
  for (const a of check.then) {
    L.push(`    ${assertExpr(a)}`);
  }
  L.push(`  });`);
  L.push(`});`);
  L.push(``);
  return L.join("\n");
}
