import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { SecurityCheck } from "./schema/security-check.zod.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

export function readSecurityChecks(vpDir) {
  const dir = path.join(vpDir, "security");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(dir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = SecurityCheck.parse(raw);
      parsed.__file = `vp/security/${f}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/security/${f}`, err);
      throw err;
    }
  });
}

export function securityAssertExpr(a) {
  if (a.status !== undefined) {
    return `expect(res.status()).toBe(${a.status});`;
  }
  if (a.header_equals) {
    const { name, equals } = a.header_equals;
    return `expect(res.headers()[${JSON.stringify(name.toLowerCase())}]).toBe(${JSON.stringify(equals)});`;
  }
  if (a.header_matches) {
    const { name, matches, regex } = a.header_matches;
    const pattern = matches || regex;
    return `expect(res.headers()[${JSON.stringify(name.toLowerCase())}]).toMatch(new RegExp(${JSON.stringify(pattern)}));`;
  }
  if (a.header_absent) {
    return `expect(Object.prototype.hasOwnProperty.call(res.headers(), ${JSON.stringify(a.header_absent.name.toLowerCase())})).toBe(false);`;
  }
  if (a.body_contains) {
    return `expect(await res.text()).toContain(${JSON.stringify(a.body_contains)});`;
  }
  if (a.body_not_contains) {
    return `expect(await res.text()).not.toContain(${JSON.stringify(a.body_not_contains)});`;
  }
  throw new Error("Unknown security assert");
}

export function genSecurityTest(check) {
  const url = check.app.base_url + check.request.path;
  const method = check.request.method.toLowerCase();
  const L = [];
  const hasHeaders = check.request.headers && Object.keys(check.request.headers).length > 0;
  const hasBody = check.request.body !== undefined || check.request.body_json !== undefined;

  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(``);
  L.push(`test.describe(${JSON.stringify(`Security: ${check.category}`)}, () => {`);
  L.push(`  test(${JSON.stringify(`${check.id}: ${check.title}`)}, async ({ request }) => {`);

  if (hasHeaders || hasBody) {
    L.push(`    const res = await request.${method}(${JSON.stringify(url)}, {`);
    if (hasHeaders) L.push(`      headers: ${JSON.stringify(check.request.headers)},`);
    if (check.request.body !== undefined) L.push(`      data: ${JSON.stringify(check.request.body)},`);
    if (check.request.body_json !== undefined) L.push(`      data: ${JSON.stringify(check.request.body_json)},`);
    L.push(`    });`);
  } else {
    L.push(`    const res = await request.${method}(${JSON.stringify(url)});`);
  }

  for (const a of check.assert) {
    L.push(`    ${securityAssertExpr(a)}`);
  }

  L.push(`  });`);
  L.push(`});`);
  L.push(``);
  return L.join("\n");
}
