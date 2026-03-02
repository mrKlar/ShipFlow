import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { mkdirp, listFilesRec, writeFile } from "./util/fs.js";
import { sha256 } from "./util/hash.js";
import { UiCheck } from "./schema/ui-check.zod.js";

function readUiChecks(vpDir) {
  const uiDir = path.join(vpDir, "ui");
  if (!fs.existsSync(uiDir)) return [];
  const files = fs.readdirSync(uiDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(uiDir, f);
    const obj = yaml.load(fs.readFileSync(full, "utf-8"));
    const parsed = UiCheck.parse(obj);
    parsed.__file = `vp/ui/${f}`;
    return parsed;
  });
}

function locatorExpr(click) {
  const role = click.role ?? "button";
  const name = click.name;
  const useRegex = click.name_regex === true;
  if (useRegex) return `page.getByRole(${JSON.stringify(role)}, { name: new RegExp(${JSON.stringify(name)}) })`;
  return `page.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)} })`;
}

function assertExpr(a) {
  if (a.text_equals) {
    const { testid, equals } = a.text_equals;
    return `await expect(page.getByTestId(${JSON.stringify(testid)})).toHaveText(${JSON.stringify(equals)});`;
  }
  if (a.text_matches) {
    const { testid, regex } = a.text_matches;
    return `await expect(page.getByTestId(${JSON.stringify(testid)})).toHaveText(new RegExp(${JSON.stringify(regex)}));`;
  }
  throw new Error("Unknown assert");
}

function genPlaywrightSpec(check) {
  const baseUrl = check.app.base_url;
  const title = `${check.id}: ${check.title}`;
  const L = [];
  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(``);
  L.push(`test(${JSON.stringify(title)}, async ({ page }) => {`);
  L.push(`  await page.goto(${JSON.stringify(baseUrl)});`);
  for (const step of check.flow) {
    if (step.open) L.push(`  await page.goto(${JSON.stringify(baseUrl + step.open)});`);
    else if (step.click) L.push(`  await ${locatorExpr(step.click)}.click();`);
    else if (step.wait_for) L.push(`  await page.waitForTimeout(${step.wait_for.ms ?? 250});`);
    else throw new Error(`Unknown step in ${check.id}`);
  }
  for (const a of check.assert) L.push(`  ${assertExpr(a)}`);
  L.push(`});`);
  L.push(``);
  return L.join("\n");
}

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

export async function gen({ cwd }) {
  const vpDir = path.join(cwd, "vp");
  const genDir = path.join(cwd, ".gen");
  const outDir = path.join(genDir, "playwright");
  mkdirp(outDir);

  const checks = readUiChecks(vpDir);
  for (const check of checks) {
    const spec = genPlaywrightSpec(check);
    const outName = check.__file.replaceAll("/", "_").replace(".yml", ".spec.ts").replace(".yaml", ".spec.ts");
    writeFile(path.join(outDir, outName), spec);
  }

  buildVpLock(cwd, vpDir, genDir);
  console.log(`ShipFlow gen: ${checks.length} UI checks -> .gen/playwright + vp.lock.json`);
}
