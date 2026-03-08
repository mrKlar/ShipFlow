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

const REQUEST_SPEC = {"method":"GET","path":"/api/users","headers":{"Authorization":"Bearer test-token"}};
const MUTATION_REQUEST_SPEC = {"method":"GET","path":"/api/users","headers":{"Authorization":"Bearer test-token","x-shipflow-mutant":"1"}};

async function sendShipFlowRequest(client, spec) {
  const headers = { ...(spec.headers || {}) };
  if (spec.auth) {
    const authToken = spec.auth.env ? (process.env[spec.auth.env] ?? (spec.auth.token ?? "")) : (spec.auth.token ?? "");
    if (!authToken) throw new Error("Missing auth token for list-users");
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
    res.status() === 200,
    new RegExp("application/json").test(String(res.headers()["content-type"] ?? "")),
    jsonPath(body, "$").exists && Array.isArray(jsonPath(body, "$").value) && jsonPath(body, "$").value.length === 3,
    jsonPath(body, "$[0].name").exists && JSON.stringify(jsonPath(body, "$[0].name").value) === JSON.stringify("Alice"),
  ].every(Boolean);
}

test("list-users: GET /api/users returns user list", async ({ request }) => {
  const res = await sendShipFlowRequest(request, REQUEST_SPEC);
  const rawBody = await res.text();
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    throw new Error("Expected JSON response body but parsing failed: " + err.message + "\n" + rawBody);
  }
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(new RegExp("application/json"));
  expect(jsonPath(body, "$").exists).toBe(true); expect(jsonPath(body, "$").value).toHaveLength(3);
  expect(jsonPath(body, "$[0].name").exists).toBe(true); expect(jsonPath(body, "$[0].name").value).toEqual("Alice");
});

test("list-users: GET /api/users returns user list [mutation guard]", async ({ request }) => {
  const res = await sendShipFlowRequest(request, MUTATION_REQUEST_SPEC);
  const payload = await readShipFlowPayload(res);
  const mutationGuardPasses = payload.jsonError ? false : responseMatchesOriginalAssertions(res, payload.rawBody, payload.body);
  expect(mutationGuardPasses, "Mutation strategy should invalidate the original API contract: mutated-headers").toBe(false);
});
