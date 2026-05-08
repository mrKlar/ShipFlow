import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";

function resetShipFlowState(state) {
  if (!state) return;
  if (state.kind === "sqlite") {
    const db = new DatabaseSync(state.connection);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec(state.reset_sql);
    } finally {
      db.close();
    }
    return;
  }
  throw new Error("Unsupported ShipFlow state kind: " + String(state.kind || "unknown"));
}


function jsonPath(root, path) {
  if (path === "$") return { exists: true, value: root };
  const parts = String(path).replace(/^\$\.?/, "").match(/[^.[\]]+|\[(\d+)\]/g) || [];
  let current = root;
  for (const raw of parts) {
    const key = raw.startsWith("[") ? Number(raw.slice(1, -1)) : raw;
    if (current === null || current === undefined || !(key in Object(current))) return { exists: false, value: undefined };
    current = current[key];
  }
  return { exists: true, value: current };
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function jsonMatchesSchema(value, schema) {
  if (schema.type && jsonType(value) !== schema.type) return false;
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (schema.required) {
    if (!(value && typeof value === "object" && !Array.isArray(value))) return false;
    for (const key of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
    }
  }
  if (schema.properties) {
    if (!(value && typeof value === "object" && !Array.isArray(value))) return false;
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (!jsonMatchesSchema(value[key], child)) return false;
    }
  }
  if (schema.items) {
    if (!Array.isArray(value)) return false;
    for (const item of value) {
      if (!jsonMatchesSchema(item, schema.items)) return false;
    }
  }
  return true;
}

function assertJsonSchema(value, schema, at = "$") {
  expect(jsonMatchesSchema(value, schema)).toBe(true);
}

function shipflowValuesMatch(actual, expected) {
  if (expected === null || typeof expected !== "object") return JSON.stringify(actual) === JSON.stringify(expected);
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((item, index) => shipflowValuesMatch(actual[index], item));
  }
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => shipflowValuesMatch(actual[key], value));
}

function shipflowArrayIncludes(actual, expected) {
  return Array.isArray(actual) && actual.some(item => shipflowValuesMatch(item, expected));
}

const shipflowBaseUrl = process.env.SHIPFLOW_BASE_URL || "http://localhost:3000";
const shipflowApiTimeoutMs = Number.parseInt(process.env.SHIPFLOW_API_TIMEOUT_MS || "", 10) || 15000;

const REQUEST_SPEC = {"method":"GET","path":"/api/todos?filter=active"};
const MUTATION_REQUEST_SPECS = [{"method":"GET","path":"/api/todos/__shipflow_mutant__?filter=active"},{"method":"POST","path":"/api/todos?filter=active"},{"method":"GET","path":"/api/todos?filter=active&__shipflow_mutant__=1"}];
const MUTATION_STRATEGIES = ["mutated-path-segment","mutated-method","path-query"];
const MUTATION_GUARD = {"mode":"any","required_strategies":[]};

async function sendShipFlowRequest(client, spec) {
  const headers = { ...(spec.headers || {}) };
  if (spec.auth) {
    const authToken = spec.auth.env ? (process.env[spec.auth.env] ?? (spec.auth.token ?? "")) : (spec.auth.token ?? "");
    if (!authToken) throw new Error("Missing auth token for api-get-todos");
    headers[spec.auth.header || "Authorization"] = (spec.auth.prefix ?? "Bearer ") + authToken;
  }
  const options = {};
  if (Object.keys(headers).length > 0) options.headers = headers;
  if (spec.body !== undefined) options.data = spec.body;
  if (spec.body_json !== undefined) options.data = spec.body_json;
  options.timeout = shipflowApiTimeoutMs;
  const url = shipflowBaseUrl + spec.path;
  if (Object.keys(options).length > 0) return client[spec.method.toLowerCase()](url, options);
  return client[spec.method.toLowerCase()](url);
}

async function readShipFlowPayload(res) {
  const rawBody = await res.text();
  try {
    return { rawBody, body: JSON.parse(rawBody), jsonError: null };
  } catch (err) {
    return { rawBody, body: undefined, jsonError: err.message };
  }
}

function responseMatchesOriginalAssertions(res, rawBody, body) {
  return [
    res.status() === 200,
    new RegExp("json").test(String(res.headers()["content-type"] ?? "")),
    jsonPath(body, "$").exists && jsonType(jsonPath(body, "$").value) === "array",
    jsonPath(body, "$").exists && Array.isArray(jsonPath(body, "$").value) && jsonPath(body, "$").value.length === 1,
    jsonPath(body, "$").exists && shipflowArrayIncludes(jsonPath(body, "$").value, {"title":"Task two","completed":false}),
    jsonPath(body, "$").exists && jsonMatchesSchema(jsonPath(body, "$").value, {"type":"array","items":{"type":"object","required":["id","title","completed"],"properties":{"id":{"type":"number"},"title":{"type":"string"},"completed":{"type":"boolean"}}}}),
  ].every(Boolean);
}

test("api-get-todos: GET /api/todos?filter=active returns only active todos", async ({ request }) => {
  resetShipFlowState({"kind":"sqlite","connection":"./test.db","reset_sql":"CREATE TABLE IF NOT EXISTS todos (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL,\n  completed INTEGER NOT NULL DEFAULT 0\n);\nDELETE FROM todos;\nINSERT INTO todos (id, title, completed) VALUES (1, 'Task one', 1);\nINSERT INTO todos (id, title, completed) VALUES (2, 'Task two', 0);"});
  const res = await sendShipFlowRequest(request, REQUEST_SPEC);
  const rawBody = await res.text();
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    throw new Error("Expected JSON response body but parsing failed: " + err.message + "\n" + rawBody);
  }
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(new RegExp("json"));
  expect(jsonPath(body, "$").exists).toBe(true); expect(jsonType(jsonPath(body, "$").value)).toBe("array");
  expect(jsonPath(body, "$").exists).toBe(true); expect(jsonPath(body, "$").value).toHaveLength(1);
  expect(jsonPath(body, "$").exists).toBe(true); expect(shipflowArrayIncludes(jsonPath(body, "$").value, {"title":"Task two","completed":false})).toBe(true);
  expect(jsonPath(body, "$").exists).toBe(true); assertJsonSchema(jsonPath(body, "$").value, {"type":"array","items":{"type":"object","required":["id","title","completed"],"properties":{"id":{"type":"number"},"title":{"type":"string"},"completed":{"type":"boolean"}}}}, "$");
});

test("api-get-todos: GET /api/todos?filter=active returns only active todos [mutation guard]", async ({ request }) => {
  resetShipFlowState({"kind":"sqlite","connection":"./test.db","reset_sql":"CREATE TABLE IF NOT EXISTS todos (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL,\n  completed INTEGER NOT NULL DEFAULT 0\n);\nDELETE FROM todos;\nINSERT INTO todos (id, title, completed) VALUES (1, 'Task one', 1);\nINSERT INTO todos (id, title, completed) VALUES (2, 'Task two', 0);"});
  let mutationGuardKilled = 0;
  const killedStrategies = [];
  const survivors = [];
  for (let index = 0; index < MUTATION_REQUEST_SPECS.length; index += 1) {
    const res = await sendShipFlowRequest(request, MUTATION_REQUEST_SPECS[index]);
    const payload = await readShipFlowPayload(res);
    const mutationGuardPasses = payload.jsonError ? false : responseMatchesOriginalAssertions(res, payload.rawBody, payload.body);
    if (mutationGuardPasses) survivors.push(MUTATION_STRATEGIES[index]);
    else {
      killedStrategies.push(MUTATION_STRATEGIES[index]);
      mutationGuardKilled += 1;
    }
  }
  const missingRequiredStrategies = (MUTATION_GUARD.required_strategies || []).filter(strategy => !killedStrategies.includes(strategy));
  if (MUTATION_GUARD.mode === "all") {
    expect(survivors, "Expected every API mutation to invalidate the original contract. Survivors: " + survivors.join(", ")).toEqual([]);
  } else {
    expect(mutationGuardKilled, "Expected at least one mutation to invalidate the original API contract. Survivors: " + survivors.join(", ")).toBeGreaterThan(0);
  }
  expect(missingRequiredStrategies, "Expected required API mutation strategies to be killed. Missing: " + missingRequiredStrategies.join(", ")).toEqual([]);
});
