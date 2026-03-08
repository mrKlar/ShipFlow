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
  if (a.header_present) {
    return `expect(res.headers()[${JSON.stringify(a.header_present.name.toLowerCase())}]).toBeDefined();`;
  }
  if (a.header_absent) {
    return `expect(res.headers()[${JSON.stringify(a.header_absent.name.toLowerCase())}]).toBeUndefined();`;
  }
  if (a.body_contains) {
    return `expect(rawBody).toContain(${JSON.stringify(a.body_contains)});`;
  }
  if (a.body_not_contains) {
    return `expect(rawBody).not.toContain(${JSON.stringify(a.body_not_contains)});`;
  }
  if (a.json_equals) {
    return `expect(jsonPath(body, ${JSON.stringify(a.json_equals.path)}).exists).toBe(true); expect(jsonPath(body, ${JSON.stringify(a.json_equals.path)}).value).toEqual(${JSON.stringify(a.json_equals.equals)});`;
  }
  if (a.json_matches) {
    const pattern = a.json_matches.matches || a.json_matches.regex;
    return `expect(jsonPath(body, ${JSON.stringify(a.json_matches.path)}).exists).toBe(true); expect(String(jsonPath(body, ${JSON.stringify(a.json_matches.path)}).value)).toMatch(new RegExp(${JSON.stringify(pattern)}));`;
  }
  if (a.json_count) {
    return `expect(jsonPath(body, ${JSON.stringify(a.json_count.path)}).exists).toBe(true); expect(jsonPath(body, ${JSON.stringify(a.json_count.path)}).value).toHaveLength(${a.json_count.count});`;
  }
  if (a.json_has) {
    return `expect(jsonPath(body, ${JSON.stringify(a.json_has.path)}).exists).toBe(true);`;
  }
  if (a.json_absent) {
    return `expect(jsonPath(body, ${JSON.stringify(a.json_absent.path)}).exists).toBe(false);`;
  }
  if (a.json_type) {
    return `expect(jsonPath(body, ${JSON.stringify(a.json_type.path)}).exists).toBe(true); expect(jsonType(jsonPath(body, ${JSON.stringify(a.json_type.path)}).value)).toBe(${JSON.stringify(a.json_type.type)});`;
  }
  if (a.json_array_includes) {
    return `expect(jsonPath(body, ${JSON.stringify(a.json_array_includes.path)}).exists).toBe(true); expect(jsonPath(body, ${JSON.stringify(a.json_array_includes.path)}).value).toContainEqual(${JSON.stringify(a.json_array_includes.equals)});`;
  }
  if (a.json_schema) {
    return `expect(jsonPath(body, ${JSON.stringify(a.json_schema.path)}).exists).toBe(true); assertJsonSchema(jsonPath(body, ${JSON.stringify(a.json_schema.path)}).value, ${JSON.stringify(a.json_schema.schema)}, ${JSON.stringify(a.json_schema.path)});`;
  }
  throw new Error("Unknown API assert");
}

export function genApiTest(check) {
  const url = check.app.base_url + check.request.path;
  const method = check.request.method.toLowerCase();
  const L = [];
  const needsRawBody = check.assert.some(a => a.body_contains || a.body_not_contains || a.json_equals || a.json_matches || a.json_count || a.json_has || a.json_absent || a.json_type || a.json_array_includes || a.json_schema);
  const needsJson = check.assert.some(a => a.json_equals || a.json_matches || a.json_count || a.json_has || a.json_absent || a.json_type || a.json_array_includes || a.json_schema);
  const needsSchema = check.assert.some(a => a.json_schema);

  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(``);
  if (needsJson) {
    L.push(`function jsonPath(root, path) {`);
    L.push(`  if (path === "$") return { exists: true, value: root };`);
    L.push(`  const parts = String(path).replace(/^\\$\\.?/, "").match(/[^.[\\]]+|\\[(\\d+)\\]/g) || [];`);
    L.push(`  let current = root;`);
    L.push(`  for (const raw of parts) {`);
    L.push(`    const key = raw.startsWith("[") ? Number(raw.slice(1, -1)) : raw;`);
    L.push(`    if (current === null || current === undefined || !(key in Object(current))) return { exists: false, value: undefined };`);
    L.push(`    current = current[key];`);
    L.push(`  }`);
    L.push(`  return { exists: true, value: current };`);
    L.push(`}`);
    L.push(``);
    L.push(`function jsonType(value) {`);
    L.push(`  if (value === null) return "null";`);
    L.push(`  if (Array.isArray(value)) return "array";`);
    L.push(`  return typeof value;`);
    L.push(`}`);
    L.push(``);
  }
  if (needsSchema) {
    L.push(`function assertJsonSchema(value, schema, at = "$") {`);
    L.push(`  if (schema.type) expect(jsonType(value)).toBe(schema.type);`);
    L.push(`  if (schema.enum) expect(schema.enum).toContainEqual(value);`);
    L.push(`  if (schema.required) {`);
    L.push(`    expect(value && typeof value === "object" && !Array.isArray(value)).toBe(true);`);
    L.push(`    for (const key of schema.required) expect(Object.prototype.hasOwnProperty.call(value, key)).toBe(true);`);
    L.push(`  }`);
    L.push(`  if (schema.properties) {`);
    L.push(`    expect(value && typeof value === "object" && !Array.isArray(value)).toBe(true);`);
    L.push(`    for (const [key, child] of Object.entries(schema.properties)) {`);
    L.push(`      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;`);
    L.push(`      assertJsonSchema(value[key], child, at + "." + key);`);
    L.push(`    }`);
    L.push(`  }`);
    L.push(`  if (schema.items) {`);
    L.push(`    expect(Array.isArray(value)).toBe(true);`);
    L.push(`    for (const item of value) assertJsonSchema(item, schema.items, at + "[]");`);
    L.push(`  }`);
    L.push(`}`);
    L.push(``);
  }
  L.push(`test(${JSON.stringify(`${check.id}: ${check.title}`)}, async ({ request }) => {`);

  const hasHeaders = check.request.headers && Object.keys(check.request.headers).length > 0;
  const hasAuth = !!check.request.auth;
  const hasBody = check.request.body !== undefined || check.request.body_json !== undefined;

  if (hasHeaders || hasAuth) {
    L.push(`  const headers = ${JSON.stringify(check.request.headers || {})};`);
    if (hasAuth) {
      const auth = check.request.auth;
      const fallbackToken = auth.token ?? "";
      const authHeader = auth.header || "Authorization";
      const authPrefix = auth.prefix ?? "Bearer ";
      if (auth.env) {
        L.push(`  const authToken = process.env[${JSON.stringify(auth.env)}] ?? ${JSON.stringify(fallbackToken)};`);
      } else {
        L.push(`  const authToken = ${JSON.stringify(fallbackToken)};`);
      }
      L.push(`  if (!authToken) throw new Error(${JSON.stringify(`Missing auth token for ${check.id}`)});`);
      L.push(`  headers[${JSON.stringify(authHeader)}] = ${JSON.stringify(authPrefix)} + authToken;`);
    }
  }

  if (hasHeaders || hasAuth || hasBody) {
    L.push(`  const res = await request.${method}(${JSON.stringify(url)}, {`);
    if (hasHeaders || hasAuth) L.push(`    headers,`);
    if (check.request.body !== undefined) L.push(`    data: ${JSON.stringify(check.request.body)},`);
    if (check.request.body_json !== undefined) L.push(`    data: ${JSON.stringify(check.request.body_json)},`);
    L.push(`  });`);
  } else {
    L.push(`  const res = await request.${method}(${JSON.stringify(url)});`);
  }

  if (needsRawBody) L.push(`  const rawBody = await res.text();`);
  if (needsJson) {
    L.push(`  let body;`);
    L.push(`  try {`);
    L.push(`    body = JSON.parse(rawBody);`);
    L.push(`  } catch (err) {`);
    L.push(`    throw new Error("Expected JSON response body but parsing failed: " + err.message + "\\n" + rawBody);`);
    L.push(`  }`);
  }

  for (const a of check.assert) {
    L.push(`  ${apiAssertExpr(a)}`);
  }

  L.push(`});`);
  L.push(``);
  return L.join("\n");
}
