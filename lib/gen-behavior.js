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

export function isGherkinBehavior(check) {
  return check?.runner?.kind === "gherkin" || check?.runner?.framework === "cucumber";
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

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "behavior";
}

function buildResolvedBehaviorScenarios(check, fixturesMap) {
  const examples = Array.isArray(check.examples) && check.examples.length > 0 ? check.examples : [null];
  return examples.map((example, index) => {
    const title = example ? `${check.id}[${index + 1}]: ${substituteTemplate(check.scenario, example)}` : `${check.id}: ${check.scenario}`;
    const setup = check.setup
      ? (() => {
          const fixture = fixturesMap?.get(check.setup);
          if (!fixture) throw new Error(`Unknown fixture "${check.setup}" referenced in ${check.id}`);
          return fixture.flow.map(step => applyTemplate(step, example));
        })()
      : [];
    const given = check.given.map(step => applyTemplate(step, example));
    const when = check.when.map(step => applyTemplate(step, example));
    const then = check.then.map(assertion => applyTemplate(assertion, example));
    const mutationGuard = hasInteractiveUiFlow(check.when)
      ? check.then.map(assertion => assertConditionExpr(applyTemplate(assertion, example))).filter(Boolean)
      : [];
    return {
      title,
      tags: check.tags || [],
      setup,
      given,
      when,
      then,
      mutationGuard,
    };
  });
}

function genAsyncStepFunctions(steps, baseUrl) {
  if (!steps.length) return "[]";
  return `[\n${steps.map(step => `      async (page) => { ${genStep(step, baseUrl)} }`).join(",\n")}\n    ]`;
}

function genAsyncAssertFunctions(assertions) {
  if (!assertions.length) return "[]";
  return `[\n${assertions.map(assertion => `      async (page) => { ${assertExpr(assertion)} }`).join(",\n")}\n    ]`;
}

function genMutationGuardFunction(conditions) {
  if (!conditions.length) return "null";
  return `async (page) => {\n      return [\n${conditions.map(condition => `        ${condition},`).join("\n")}\n      ].every(Boolean);\n    }`;
}

export function genBehaviorFeature(check, fixturesMap) {
  const scenarios = buildResolvedBehaviorScenarios(check, fixturesMap);
  const lines = [];

  lines.push(`Feature: ${check.feature}`);
  lines.push(`  # ShipFlow generated Gherkin artifact`);
  lines.push("");

  for (const scenario of scenarios) {
    if (scenario.tags.length > 0) {
      lines.push(`  ${scenario.tags.map(tag => `@${tag.replace(/^@/, "")}`).join(" ")}`);
    }
    lines.push(`  Scenario: ${scenario.title}`);

    if (scenario.setup.length === 0 && scenario.given.length === 0 && scenario.when.length === 0 && scenario.then.length === 0) {
      lines.push("    Given ShipFlow noop");
    } else {
      for (const [index] of scenario.setup.entries()) {
        lines.push(`    Given ShipFlow setup step ${index + 1}`);
      }
      for (const [index] of scenario.given.entries()) {
        lines.push(`    Given ShipFlow given step ${index + 1}`);
      }
      for (const [index] of scenario.when.entries()) {
        lines.push(`    When ShipFlow when step ${index + 1}`);
      }
      for (const [index] of scenario.then.entries()) {
        lines.push(`    Then ShipFlow assert ${index + 1}`);
      }
    }
    lines.push("");

    if (scenario.mutationGuard.length > 0) {
      lines.push(`  Scenario: ${scenario.title} [mutation guard]`);
      for (const [index] of scenario.setup.entries()) {
        lines.push(`    Given ShipFlow setup step ${index + 1}`);
      }
      for (const [index] of scenario.given.entries()) {
        lines.push(`    Given ShipFlow given step ${index + 1}`);
      }
      lines.push("    Then ShipFlow mutation guard");
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function genBehaviorSteps(check, fixturesMap) {
  const scenarios = buildResolvedBehaviorScenarios(check, fixturesMap);
  const baseUrl = check.app.base_url;
  const lines = [];

  lines.push(`import { Before, After, Given, When, Then } from "@cucumber/cucumber";`);
  lines.push(`import { chromium, expect } from "@playwright/test";`);
  lines.push(``);
  lines.push(`const SCENARIOS = new Map([`);
  for (const scenario of scenarios) {
    lines.push(`  [${JSON.stringify(scenario.title)}, {`);
    lines.push(`    setup: ${genAsyncStepFunctions(scenario.setup, baseUrl)},`);
    lines.push(`    given: ${genAsyncStepFunctions(scenario.given, baseUrl)},`);
    lines.push(`    when: ${genAsyncStepFunctions(scenario.when, baseUrl)},`);
    lines.push(`    then: ${genAsyncAssertFunctions(scenario.then)},`);
    lines.push(`    mutationGuard: ${genMutationGuardFunction(scenario.mutationGuard)},`);
    lines.push(`  }],`);
  }
  lines.push(`]);`);
  lines.push(``);
  lines.push(`function currentScenario(world) {`);
  lines.push(`  const scenario = SCENARIOS.get(world.__shipflowScenarioName);`);
  lines.push(`  if (!scenario) throw new Error("Unknown ShipFlow Cucumber scenario: " + world.__shipflowScenarioName);`);
  lines.push(`  return scenario;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function runIndexedStep(items, index, page, kind) {`);
  lines.push(`  const fn = items[Number(index) - 1];`);
  lines.push(`  if (!fn) throw new Error("Missing ShipFlow " + kind + " step #" + index);`);
  lines.push(`  await fn(page);`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`Before(async function ({ pickle }) {`);
  lines.push(`  this.__shipflowScenarioName = String(pickle.name || "").replace(/ \\[mutation guard\\]$/, "");`);
  lines.push(`  this.__shipflowBrowser = await chromium.launch();`);
  lines.push(`  this.__shipflowContext = await this.__shipflowBrowser.newContext();`);
  lines.push(`  this.page = await this.__shipflowContext.newPage();`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`After(async function () {`);
  lines.push(`  await this.__shipflowContext?.close();`);
  lines.push(`  await this.__shipflowBrowser?.close();`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`Given("ShipFlow noop", async function () {});`);
  lines.push(``);
  lines.push(`Given(/^ShipFlow setup step (\\d+)$/, async function (index) {`);
  lines.push(`  await runIndexedStep(currentScenario(this).setup, index, this.page, "setup");`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`Given(/^ShipFlow given step (\\d+)$/, async function (index) {`);
  lines.push(`  await runIndexedStep(currentScenario(this).given, index, this.page, "given");`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`When(/^ShipFlow when step (\\d+)$/, async function (index) {`);
  lines.push(`  await runIndexedStep(currentScenario(this).when, index, this.page, "when");`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`Then(/^ShipFlow assert (\\d+)$/, async function (index) {`);
  lines.push(`  await runIndexedStep(currentScenario(this).then, index, this.page, "assert");`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`Then("ShipFlow mutation guard", async function () {`);
  lines.push(`  const scenario = currentScenario(this);`);
  lines.push(`  if (!scenario.mutationGuard) throw new Error("No ShipFlow mutation guard is defined for this scenario.");`);
  lines.push(`  const mutationGuardPasses = await scenario.mutationGuard(this.page);`);
  lines.push(`  expect(mutationGuardPasses).toBe(false);`);
  lines.push(`});`);
  lines.push(``);

  return lines.join("\n");
}

export function genBehaviorCucumberArtifacts(check, fixturesMap) {
  const baseName = check.__file.replace(/^vp\/behavior\//, "").replace(/\.ya?ml$/, "");
  const safeName = slugify(baseName);
  return [
    {
      relative_dir: "features",
      name: `${safeName}.feature`,
      kind: "cucumber-feature",
      primary: true,
      content: genBehaviorFeature(check, fixturesMap),
    },
    {
      relative_dir: "step_definitions",
      name: `${safeName}.steps.mjs`,
      kind: "cucumber-steps",
      primary: false,
      content: genBehaviorSteps(check, fixturesMap),
    },
  ];
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
