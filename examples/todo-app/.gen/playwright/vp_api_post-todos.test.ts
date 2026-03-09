import { test, expect } from "@playwright/test";

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

const REQUEST_SPEC = {"method":"POST","path":"/api/todos","body_json":{"title":"Draft task","completed":false}};
const MUTATION_REQUEST_SPECS = [{"method":"POST","path":"/api/todos","body_json":{"title":"Draft task__shipflow_mutant__","completed":false}},{"method":"POST","path":"/api/todos/__shipflow_mutant__","body_json":{"title":"Draft task","completed":false}},{"method":"GET","path":"/api/todos","body_json":{"title":"Draft task","completed":false}},{"method":"POST","path":"/api/todos?__shipflow_mutant__=1","body_json":{"title":"Draft task","completed":false}}];
const MUTATION_STRATEGIES = ["mutated-body-json","mutated-path-segment","mutated-method","path-query"];

async function sendShipFlowRequest(client, spec) {
  const headers = { ...(spec.headers || {}) };
  if (spec.auth) {
    const authToken = spec.auth.env ? (process.env[spec.auth.env] ?? (spec.auth.token ?? "")) : (spec.auth.token ?? "");
    if (!authToken) throw new Error("Missing auth token for api-post-todos");
    headers[spec.auth.header || "Authorization"] = (spec.auth.prefix ?? "Bearer ") + authToken;
  }
  const options = {};
  if (Object.keys(headers).length > 0) options.headers = headers;
  if (spec.body !== undefined) options.data = spec.body;
  if (spec.body_json !== undefined) options.data = spec.body_json;
  const url = "http://localhost:3000" + spec.path;
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
    res.status() === 201,
    new RegExp("json").test(String(res.headers()["content-type"] ?? "")),
    jsonPath(body, "$").exists && jsonType(jsonPath(body, "$").value) === "object",
    jsonPath(body, "$.id").exists,
    jsonPath(body, "$.title").exists && JSON.stringify(jsonPath(body, "$.title").value) === JSON.stringify("Draft task"),
    jsonPath(body, "$.completed").exists && JSON.stringify(jsonPath(body, "$.completed").value) === JSON.stringify(false),
    jsonPath(body, "$").exists && jsonMatchesSchema(jsonPath(body, "$").value, {"type":"object","required":["id","title","completed"],"properties":{"id":{"type":"number"},"title":{"type":"string"},"completed":{"type":"boolean"}}}),
  ].every(Boolean);
}

test("api-post-todos: POST /api/todos creates a todo", async ({ request }) => {
  const res = await sendShipFlowRequest(request, REQUEST_SPEC);
  const rawBody = await res.text();
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    throw new Error("Expected JSON response body but parsing failed: " + err.message + "\n" + rawBody);
  }
  expect(res.status()).toBe(201);
  expect(res.headers()["content-type"]).toMatch(new RegExp("json"));
  expect(jsonPath(body, "$").exists).toBe(true); expect(jsonType(jsonPath(body, "$").value)).toBe("object");
  expect(jsonPath(body, "$.id").exists).toBe(true);
  expect(jsonPath(body, "$.title").exists).toBe(true); expect(jsonPath(body, "$.title").value).toEqual("Draft task");
  expect(jsonPath(body, "$.completed").exists).toBe(true); expect(jsonPath(body, "$.completed").value).toEqual(false);
  expect(jsonPath(body, "$").exists).toBe(true); assertJsonSchema(jsonPath(body, "$").value, {"type":"object","required":["id","title","completed"],"properties":{"id":{"type":"number"},"title":{"type":"string"},"completed":{"type":"boolean"}}}, "$");
});

test("api-post-todos: POST /api/todos creates a todo [mutation guard]", async ({ request }) => {
  let mutationGuardKilled = 0;
  const survivors = [];
  for (let index = 0; index < MUTATION_REQUEST_SPECS.length; index += 1) {
    const res = await sendShipFlowRequest(request, MUTATION_REQUEST_SPECS[index]);
    const payload = await readShipFlowPayload(res);
    const mutationGuardPasses = payload.jsonError ? false : responseMatchesOriginalAssertions(res, payload.rawBody, payload.body);
    if (mutationGuardPasses) survivors.push(MUTATION_STRATEGIES[index]); else mutationGuardKilled += 1;
  }
  expect(mutationGuardKilled, "Expected at least one mutation to invalidate the original API contract. Survivors: " + survivors.join(", ")).toBeGreaterThan(0);
});
