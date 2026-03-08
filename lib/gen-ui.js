import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { UiCheck, UiFixture } from "./schema/ui-check.zod.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

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
  if (step.route_block) {
    const { path: routePath, status } = step.route_block;
    return `await page.route(${JSON.stringify("**" + routePath)}, route => route.fulfill({ status: ${status}, body: "" }));`;
  }
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

export function readUiFixtures(vpDir) {
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

export function readUiChecks(vpDir) {
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
