import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { BehaviorCheck } from "./schema/behavior-check.zod.js";
import { genStep, assertConditionExpr, assertExpr, hasInteractiveUiFlow } from "./gen-ui.js";

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

export function genBehaviorTest(check, fixturesMap) {
  const baseUrl = check.app.base_url;
  const L = [];
  const examples = Array.isArray(check.examples) && check.examples.length > 0 ? check.examples : [null];
  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(``);
  L.push(`test.describe(${JSON.stringify(check.feature)}, () => {`);
  if (check.tags?.length) {
    L.push(`  // tags: ${check.tags.join(", ")}`);
  }
  for (const [index, example] of examples.entries()) {
    const resolvedScenario = substituteTemplate(check.scenario, example);
    const title = example ? `${check.id}[${index + 1}]: ${resolvedScenario}` : `${check.id}: ${resolvedScenario}`;
    L.push(`  test(${JSON.stringify(title)}, async ({ page }) => {`);
    if (example) {
      L.push(`    // example: ${JSON.stringify(example)}`);
    }
    L.push(`    await page.goto(${JSON.stringify(baseUrl)});`);

    if (check.setup) {
      const fixture = fixturesMap?.get(check.setup);
      if (!fixture) throw new Error(`Unknown fixture "${check.setup}" referenced in ${check.id}`);
      L.push(`    // setup: ${check.setup}`);
      for (const step of fixture.flow) {
        L.push(`    ${genStep(applyTemplate(step, example), baseUrl)}`);
      }
    }

    L.push(`    // Given`);
    for (const step of check.given) {
      L.push(`    ${genStep(applyTemplate(step, example), baseUrl)}`);
    }
    L.push(`    // When`);
    for (const step of check.when) {
      L.push(`    ${genStep(applyTemplate(step, example), baseUrl)}`);
    }
    L.push(`    // Then`);
    for (const a of check.then) {
      L.push(`    ${assertExpr(applyTemplate(a, example))}`);
    }
    L.push(`  });`);

    const mutationGuardConditions = hasInteractiveUiFlow(check.when)
      ? check.then.map(assertion => assertConditionExpr(applyTemplate(assertion, example))).filter(Boolean)
      : [];
    if (mutationGuardConditions.length > 0) {
      const guardTitle = example ? `${check.id}[${index + 1}]: ${resolvedScenario} [mutation guard]` : `${check.id}: ${resolvedScenario} [mutation guard]`;
      L.push(`  test(${JSON.stringify(guardTitle)}, async ({ page }) => {`);
      if (example) {
        L.push(`    // example: ${JSON.stringify(example)}`);
      }
      L.push(`    await page.goto(${JSON.stringify(baseUrl)});`);

      if (check.setup) {
        const fixture = fixturesMap?.get(check.setup);
        if (!fixture) throw new Error(`Unknown fixture "${check.setup}" referenced in ${check.id}`);
        L.push(`    // setup: ${check.setup}`);
        for (const step of fixture.flow) {
          L.push(`    ${genStep(applyTemplate(step, example), baseUrl)}`);
        }
      }

      L.push(`    // Given`);
      for (const step of check.given) {
        L.push(`    ${genStep(applyTemplate(step, example), baseUrl)}`);
      }
      L.push(`    const mutationGuardPasses = [`);
      for (const condition of mutationGuardConditions) {
        L.push(`      ${condition},`);
      }
      L.push(`    ].every(Boolean);`);
      L.push(`    expect(mutationGuardPasses).toBe(false);`);
      L.push(`  });`);
    }
  }
  L.push(`});`);
  L.push(``);
  return L.join("\n");
}

function substituteTemplate(input, example) {
  if (!example || typeof input !== "string") return input;
  return input
    .replace(/<([a-zA-Z0-9_]+)>/g, (_, key) => String(example[key] ?? `<${key}>`))
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(example[key] ?? `{{${key}}}`));
}

function applyTemplate(value, example) {
  if (!example) return value;
  if (typeof value === "string") return substituteTemplate(value, example);
  if (Array.isArray(value)) return value.map(item => applyTemplate(item, example));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, applyTemplate(inner, example)]));
  }
  return value;
}
