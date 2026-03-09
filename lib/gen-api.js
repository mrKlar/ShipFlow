import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { ApiCheck } from "./schema/api-check.zod.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

function mutateValue(value) {
  if (typeof value === "string") return `${value}__shipflow_mutant__`;
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return !value;
  if (Array.isArray(value)) return value.length > 0 ? [...value, "__shipflow_mutant__"] : ["__shipflow_mutant__"];
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return { mutant: "__shipflow_mutant__" };
    const [firstKey, firstValue] = entries[0];
    return { ...value, [firstKey]: mutateValue(firstValue) };
  }
  return "__shipflow_mutant__";
}

function appendMutationQuery(apiPath) {
  return `${apiPath}${apiPath.includes("?") ? "&" : "?"}__shipflow_mutant__=1`;
}

function appendMutationPathSegment(apiPath) {
  const [pathname, search = ""] = String(apiPath).split("?");
  const basePath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const mutatedPath = `${basePath || ""}/__shipflow_mutant__`.replace(/\/{2,}/g, "/");
  return search ? `${mutatedPath}?${search}` : mutatedPath;
}

function alternateHttpMethod(method) {
  if (method === "GET") return "POST";
  if (method === "POST") return "GET";
  if (method === "PUT") return "GET";
  if (method === "PATCH") return "GET";
  if (method === "DELETE") return "POST";
  return "GET";
}

function dedupeMutationSpecs(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = `${item.strategy}:${JSON.stringify(item.mutant)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export function buildMutantApiRequest(request) {
  return buildMutantApiRequests(request)[0];
}

export function buildMutantApiRequests(request) {
  const variants = [];

  if (request.auth) {
    const mutant = JSON.parse(JSON.stringify(request));
    mutant.auth = {
      ...mutant.auth,
      env: undefined,
      token: "__shipflow_invalid_token__",
    };
    variants.push({ mutant, strategy: "invalid-auth" });
  }

  if (request.body_json !== undefined) {
    const mutant = JSON.parse(JSON.stringify(request));
    mutant.body_json = mutateValue(mutant.body_json);
    variants.push({ mutant, strategy: "mutated-body-json" });
  }

  if (request.body !== undefined) {
    const mutant = JSON.parse(JSON.stringify(request));
    mutant.body = mutateValue(mutant.body);
    variants.push({ mutant, strategy: "mutated-body" });
  }

  if (request.headers && Object.keys(request.headers).length > 0) {
    const mutant = JSON.parse(JSON.stringify(request));
    mutant.headers = { ...mutant.headers, "x-shipflow-mutant": "1" };
    variants.push({ mutant, strategy: "mutated-headers" });
  }

  if (request.path) {
    const mutant = JSON.parse(JSON.stringify(request));
    mutant.path = appendMutationPathSegment(mutant.path);
    variants.push({ mutant, strategy: "mutated-path-segment" });
  }

  if (request.method) {
    const mutant = JSON.parse(JSON.stringify(request));
    mutant.method = alternateHttpMethod(mutant.method);
    variants.push({ mutant, strategy: "mutated-method" });
  }

  if (request.path) {
    const mutant = JSON.parse(JSON.stringify(request));
    mutant.path = appendMutationQuery(mutant.path);
    variants.push({ mutant, strategy: "path-query" });
  }

  return dedupeMutationSpecs(variants);
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

export function apiAssertConditionExpr(a) {
  if (a.status !== undefined) {
    return `res.status() === ${a.status}`;
  }
  if (a.header_equals) {
    const { name, equals } = a.header_equals;
    return `res.headers()[${JSON.stringify(name.toLowerCase())}] === ${JSON.stringify(equals)}`;
  }
  if (a.header_matches) {
    const { name, matches, regex } = a.header_matches;
    const pattern = matches || regex;
    return `new RegExp(${JSON.stringify(pattern)}).test(String(res.headers()[${JSON.stringify(name.toLowerCase())}] ?? ""))`;
  }
  if (a.header_present) {
    return `res.headers()[${JSON.stringify(a.header_present.name.toLowerCase())}] !== undefined`;
  }
  if (a.header_absent) {
    return `res.headers()[${JSON.stringify(a.header_absent.name.toLowerCase())}] === undefined`;
  }
  if (a.body_contains) {
    return `rawBody.includes(${JSON.stringify(a.body_contains)})`;
  }
  if (a.body_not_contains) {
    return `!rawBody.includes(${JSON.stringify(a.body_not_contains)})`;
  }
  if (a.json_equals) {
    return `jsonPath(body, ${JSON.stringify(a.json_equals.path)}).exists && JSON.stringify(jsonPath(body, ${JSON.stringify(a.json_equals.path)}).value) === JSON.stringify(${JSON.stringify(a.json_equals.equals)})`;
  }
  if (a.json_matches) {
    const pattern = a.json_matches.matches || a.json_matches.regex;
    return `jsonPath(body, ${JSON.stringify(a.json_matches.path)}).exists && new RegExp(${JSON.stringify(pattern)}).test(String(jsonPath(body, ${JSON.stringify(a.json_matches.path)}).value))`;
  }
  if (a.json_count) {
    return `jsonPath(body, ${JSON.stringify(a.json_count.path)}).exists && Array.isArray(jsonPath(body, ${JSON.stringify(a.json_count.path)}).value) && jsonPath(body, ${JSON.stringify(a.json_count.path)}).value.length === ${a.json_count.count}`;
  }
  if (a.json_has) {
    return `jsonPath(body, ${JSON.stringify(a.json_has.path)}).exists`;
  }
  if (a.json_absent) {
    return `!jsonPath(body, ${JSON.stringify(a.json_absent.path)}).exists`;
  }
  if (a.json_type) {
    return `jsonPath(body, ${JSON.stringify(a.json_type.path)}).exists && jsonType(jsonPath(body, ${JSON.stringify(a.json_type.path)}).value) === ${JSON.stringify(a.json_type.type)}`;
  }
  if (a.json_array_includes) {
    return `jsonPath(body, ${JSON.stringify(a.json_array_includes.path)}).exists && Array.isArray(jsonPath(body, ${JSON.stringify(a.json_array_includes.path)}).value) && jsonPath(body, ${JSON.stringify(a.json_array_includes.path)}).value.some(item => JSON.stringify(item) === JSON.stringify(${JSON.stringify(a.json_array_includes.equals)}))`;
  }
  if (a.json_schema) {
    return `jsonPath(body, ${JSON.stringify(a.json_schema.path)}).exists && jsonMatchesSchema(jsonPath(body, ${JSON.stringify(a.json_schema.path)}).value, ${JSON.stringify(a.json_schema.schema)})`;
  }
  throw new Error("Unknown API assert");
}

export function genApiTest(check) {
  const requestSpec = check.request;
  const mutationVariants = buildMutantApiRequests(check.request);
  const mutantRequestSpecs = mutationVariants.map(item => item.mutant);
  const mutationStrategies = mutationVariants.map(item => item.strategy);
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
    L.push(`function jsonMatchesSchema(value, schema) {`);
    L.push(`  if (schema.type && jsonType(value) !== schema.type) return false;`);
    L.push(`  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;`);
    L.push(`  if (schema.required) {`);
    L.push(`    if (!(value && typeof value === "object" && !Array.isArray(value))) return false;`);
    L.push(`    for (const key of schema.required) {`);
    L.push(`      if (!Object.prototype.hasOwnProperty.call(value, key)) return false;`);
    L.push(`    }`);
    L.push(`  }`);
    L.push(`  if (schema.properties) {`);
    L.push(`    if (!(value && typeof value === "object" && !Array.isArray(value))) return false;`);
    L.push(`    for (const [key, child] of Object.entries(schema.properties)) {`);
    L.push(`      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;`);
    L.push(`      if (!jsonMatchesSchema(value[key], child)) return false;`);
    L.push(`    }`);
    L.push(`  }`);
    L.push(`  if (schema.items) {`);
    L.push(`    if (!Array.isArray(value)) return false;`);
    L.push(`    for (const item of value) {`);
    L.push(`      if (!jsonMatchesSchema(item, schema.items)) return false;`);
    L.push(`    }`);
    L.push(`  }`);
    L.push(`  return true;`);
    L.push(`}`);
    L.push(``);
    L.push(`function assertJsonSchema(value, schema, at = "$") {`);
    L.push(`  expect(jsonMatchesSchema(value, schema)).toBe(true);`);
    L.push(`}`);
    L.push(``);
  }
  L.push(`const REQUEST_SPEC = ${JSON.stringify(requestSpec)};`);
  L.push(`const MUTATION_REQUEST_SPECS = ${JSON.stringify(mutantRequestSpecs)};`);
  L.push(`const MUTATION_STRATEGIES = ${JSON.stringify(mutationStrategies)};`);
  L.push(``);
  L.push(`async function sendShipFlowRequest(client, spec) {`);
  L.push(`  const headers = { ...(spec.headers || {}) };`);
  L.push(`  if (spec.auth) {`);
  L.push(`    const authToken = spec.auth.env ? (process.env[spec.auth.env] ?? (spec.auth.token ?? "")) : (spec.auth.token ?? "");`);
  L.push(`    if (!authToken) throw new Error(${JSON.stringify(`Missing auth token for ${check.id}`)});`);
  L.push(`    headers[spec.auth.header || "Authorization"] = (spec.auth.prefix ?? "Bearer ") + authToken;`);
  L.push(`  }`);
  L.push(`  const options = {};`);
  L.push(`  if (Object.keys(headers).length > 0) options.headers = headers;`);
  L.push(`  if (spec.body !== undefined) options.data = spec.body;`);
  L.push(`  if (spec.body_json !== undefined) options.data = spec.body_json;`);
  L.push(`  const url = ${JSON.stringify(check.app.base_url)} + spec.path;`);
  L.push(`  if (Object.keys(options).length > 0) return client[spec.method.toLowerCase()](url, options);`);
  L.push(`  return client[spec.method.toLowerCase()](url);`);
  L.push(`}`);
  L.push(``);
  L.push(`async function readShipFlowPayload(res) {`);
  if (needsRawBody) {
    L.push(`  const rawBody = await res.text();`);
  } else {
    L.push(`  const rawBody = "";`);
  }
  if (needsJson) {
    L.push(`  try {`);
    L.push(`    return { rawBody, body: JSON.parse(rawBody), jsonError: null };`);
    L.push(`  } catch (err) {`);
    L.push(`    return { rawBody, body: undefined, jsonError: err.message };`);
    L.push(`  }`);
  } else {
    L.push(`  return { rawBody, body: undefined, jsonError: null };`);
  }
  L.push(`}`);
  L.push(``);
  L.push(`function responseMatchesOriginalAssertions(res, rawBody, body) {`);
  L.push(`  return [`);
  for (const a of check.assert) {
    L.push(`    ${apiAssertConditionExpr(a)},`);
  }
  L.push(`  ].every(Boolean);`);
  L.push(`}`);
  L.push(``);
  L.push(`test(${JSON.stringify(`${check.id}: ${check.title}`)}, async ({ request }) => {`);
  L.push(`  const res = await sendShipFlowRequest(request, REQUEST_SPEC);`);

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
  L.push(`test(${JSON.stringify(`${check.id}: ${check.title} [mutation guard]`)}, async ({ request }) => {`);
  L.push(`  let mutationGuardKilled = 0;`);
  L.push(`  const survivors = [];`);
  L.push(`  for (let index = 0; index < MUTATION_REQUEST_SPECS.length; index += 1) {`);
  L.push(`    const res = await sendShipFlowRequest(request, MUTATION_REQUEST_SPECS[index]);`);
  L.push(`    const payload = await readShipFlowPayload(res);`);
  L.push(`    const mutationGuardPasses = payload.jsonError ? false : responseMatchesOriginalAssertions(res, payload.rawBody, payload.body);`);
  L.push(`    if (mutationGuardPasses) survivors.push(MUTATION_STRATEGIES[index]); else mutationGuardKilled += 1;`);
  L.push(`  }`);
  L.push(`  expect(mutationGuardKilled, "Expected at least one mutation to invalidate the original API contract. Survivors: " + survivors.join(", ")).toBeGreaterThan(0);`);
  L.push(`});`);
  L.push(``);
  return L.join("\n");
}
