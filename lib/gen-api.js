import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { ApiCheck } from "./schema/api-check.zod.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

export function readApiChecks(vpDir) {
  const dir = path.join(vpDir, "api");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(dir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = ApiCheck.parse(raw);
      parsed.__file = `vp/api/${f}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/api/${f}`, err);
      throw err;
    }
  });
}

export function apiAssertExpr(a) {
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
  if (a.body_contains) {
    return `expect(await res.text()).toContain(${JSON.stringify(a.body_contains)});`;
  }
  if (a.json_equals) {
    const expr = a.json_equals.path.replace(/^\$/, "body");
    return `expect(${expr}).toBe(${JSON.stringify(a.json_equals.equals)});`;
  }
  if (a.json_matches) {
    const expr = a.json_matches.path.replace(/^\$/, "body");
    const pattern = a.json_matches.matches || a.json_matches.regex;
    return `expect(String(${expr})).toMatch(new RegExp(${JSON.stringify(pattern)}));`;
  }
  if (a.json_count) {
    const expr = a.json_count.path.replace(/^\$/, "body");
    return `expect(${expr}).toHaveLength(${a.json_count.count});`;
  }
  throw new Error("Unknown API assert");
}

export function genApiTest(check) {
  const url = check.app.base_url + check.request.path;
  const method = check.request.method.toLowerCase();
  const L = [];

  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(``);
  L.push(`test(${JSON.stringify(`${check.id}: ${check.title}`)}, async ({ request }) => {`);

  // Build request call
  const hasHeaders = check.request.headers && Object.keys(check.request.headers).length > 0;
  const hasBody = check.request.body !== undefined || check.request.body_json !== undefined;

  if (hasHeaders || hasBody) {
    L.push(`  const res = await request.${method}(${JSON.stringify(url)}, {`);
    if (hasHeaders) L.push(`    headers: ${JSON.stringify(check.request.headers)},`);
    if (check.request.body !== undefined) L.push(`    data: ${JSON.stringify(check.request.body)},`);
    if (check.request.body_json !== undefined) L.push(`    data: ${JSON.stringify(check.request.body_json)},`);
    L.push(`  });`);
  } else {
    L.push(`  const res = await request.${method}(${JSON.stringify(url)});`);
  }

  // Parse body if needed
  const needsJson = check.assert.some(a => a.json_equals || a.json_matches || a.json_count);
  if (needsJson) L.push(`  const body = await res.json();`);

  for (const a of check.assert) {
    L.push(`  ${apiAssertExpr(a)}`);
  }

  L.push(`});`);
  L.push(``);
  return L.join("\n");
}
