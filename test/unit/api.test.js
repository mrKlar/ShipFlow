import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiCheck } from "../../lib/schema/api-check.zod.js";
import { apiAssertExpr, genApiTest } from "../../lib/gen-api.js";

const base = {
  id: "get-users",
  title: "List users",
  severity: "blocker",
  app: { kind: "api", base_url: "http://localhost:3000" },
  request: { method: "GET", path: "/api/users" },
};

describe("ApiCheck schema", () => {
  it("accepts valid API check", () => {
    const r = ApiCheck.parse({ ...base, assert: [{ status: 200 }] });
    assert.equal(r.id, "get-users");
    assert.equal(r.request.method, "GET");
  });

  it("accepts all HTTP methods", () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const r = ApiCheck.parse({
        ...base,
        request: { method, path: "/api/x" },
        assert: [],
      });
      assert.equal(r.request.method, method);
    }
  });

  it("accepts headers", () => {
    const r = ApiCheck.parse({
      ...base,
      request: { method: "GET", path: "/x", headers: { Authorization: "Bearer tok" } },
      assert: [],
    });
    assert.equal(r.request.headers.Authorization, "Bearer tok");
  });

  it("accepts body string", () => {
    const r = ApiCheck.parse({
      ...base,
      request: { method: "POST", path: "/x", body: "raw data" },
      assert: [],
    });
    assert.equal(r.request.body, "raw data");
  });

  it("accepts body_json", () => {
    const r = ApiCheck.parse({
      ...base,
      request: { method: "POST", path: "/x", body_json: { name: "Alice" } },
      assert: [],
    });
    assert.deepEqual(r.request.body_json, { name: "Alice" });
  });

  it("accepts all assert types", () => {
    const r = ApiCheck.parse({
      ...base,
      assert: [
        { status: 200 },
        { header_equals: { name: "x-id", equals: "abc" } },
        { header_matches: { name: "content-type", matches: "json" } },
        { header_present: { name: "x-trace-id" } },
        { header_absent: { name: "x-internal" } },
        { body_contains: "hello" },
        { body_not_contains: "stack trace" },
        { json_equals: { path: "$.name", equals: "Alice" } },
        { json_matches: { path: "$.status", matches: "active" } },
        { json_count: { path: "$", count: 5 } },
        { json_has: { path: "$.meta" } },
        { json_absent: { path: "$.debug" } },
        { json_type: { path: "$.items", type: "array" } },
        { json_array_includes: { path: "$.items", equals: { id: 1 } } },
        { json_schema: { path: "$", schema: { type: "object", required: ["name"] } } },
      ],
    });
    assert.equal(r.assert.length, 15);
  });

  it("accepts bearer auth configuration", () => {
    const r = ApiCheck.parse({
      ...base,
      request: {
        method: "GET",
        path: "/secure",
        auth: { kind: "bearer", env: "API_TOKEN" },
      },
      assert: [{ status: 200 }],
    });
    assert.equal(r.request.auth.kind, "bearer");
  });

  it("rejects unknown assert", () => {
    assert.throws(() => {
      ApiCheck.parse({ ...base, assert: [{ unknown: true }] });
    });
  });

  it("rejects invalid method", () => {
    assert.throws(() => {
      ApiCheck.parse({ ...base, request: { method: "TRACE", path: "/" }, assert: [] });
    });
  });
});

describe("apiAssertExpr", () => {
  it("generates status check", () => {
    assert.equal(apiAssertExpr({ status: 200 }), "expect(res.status()).toBe(200);");
  });

  it("generates header_equals", () => {
    const r = apiAssertExpr({ header_equals: { name: "X-Id", equals: "abc" } });
    assert.ok(r.includes('"x-id"'));
    assert.ok(r.includes('.toBe("abc")'));
  });

  it("generates header_matches", () => {
    const r = apiAssertExpr({ header_matches: { name: "Content-Type", matches: "json" } });
    assert.ok(r.includes('"content-type"'));
    assert.ok(r.includes("toMatch"));
  });

  it("generates body_contains", () => {
    const r = apiAssertExpr({ body_contains: "hello" });
    assert.ok(r.includes("toContain"));
    assert.ok(r.includes('"hello"'));
  });

  it("generates header_present", () => {
    const r = apiAssertExpr({ header_present: { name: "X-Trace-Id" } });
    assert.ok(r.includes('"x-trace-id"'));
    assert.ok(r.includes("toBeDefined"));
  });

  it("generates body_not_contains", () => {
    const r = apiAssertExpr({ body_not_contains: "stack" });
    assert.ok(r.includes("not.toContain"));
  });

  it("generates json_equals", () => {
    const r = apiAssertExpr({ json_equals: { path: "$[0].name", equals: "Alice" } });
    assert.ok(r.includes('jsonPath(body, "$[0].name")'));
    assert.ok(r.includes('toEqual("Alice")'));
  });

  it("generates json_matches", () => {
    const r = apiAssertExpr({ json_matches: { path: "$.status", matches: "active" } });
    assert.ok(r.includes('jsonPath(body, "$.status")'));
    assert.ok(r.includes("toMatch"));
  });

  it("generates json_count", () => {
    const r = apiAssertExpr({ json_count: { path: "$", count: 3 } });
    assert.ok(r.includes('jsonPath(body, "$")'));
    assert.ok(r.includes("toHaveLength(3)"));
  });

  it("generates json_schema", () => {
    const r = apiAssertExpr({ json_schema: { path: "$", schema: { type: "object", required: ["id"] } } });
    assert.ok(r.includes("assertJsonSchema"));
  });

  it("throws on unknown assert", () => {
    assert.throws(() => apiAssertExpr({ unknown: {} }), /Unknown API assert/);
  });
});

describe("genApiTest", () => {
  it("generates GET request", () => {
    const code = genApiTest({ ...base, assert: [{ status: 200 }] });
    assert.ok(code.includes("REQUEST_SPEC"));
    assert.ok(code.includes("MUTATION_REQUEST_SPEC"));
    assert.ok(code.includes("sendShipFlowRequest"));
    assert.ok(code.includes('"path":"/api/users"'));
    assert.ok(code.includes("toBe(200)"));
  });

  it("generates POST with body_json", () => {
    const check = {
      ...base,
      request: { method: "POST", path: "/api/users", body_json: { name: "Bob" } },
      assert: [{ status: 201 }],
    };
    const code = genApiTest(check);
    assert.ok(code.includes('"method":"POST"'));
    assert.ok(code.includes('"body_json":{"name":"Bob"}'));
    assert.ok(code.includes("Mutation strategy should invalidate the original API contract"));
  });

  it("generates headers", () => {
    const check = {
      ...base,
      request: { method: "GET", path: "/x", headers: { Authorization: "Bearer tok" } },
      assert: [],
    };
    const code = genApiTest(check);
    assert.ok(code.includes("Authorization"));
    assert.ok(code.includes("Bearer tok"));
  });

  it("parses JSON body when json assertions exist", () => {
    const check = {
      ...base,
      assert: [{ json_equals: { path: "$.name", equals: "Alice" } }],
    };
    const code = genApiTest(check);
    assert.ok(code.includes("const rawBody = await res.text()"));
    assert.ok(code.includes("JSON.parse(rawBody)"));
    assert.ok(code.includes("jsonPath(body"));
  });

  it("does not parse JSON when only status check", () => {
    const code = genApiTest({ ...base, assert: [{ status: 200 }] });
    assert.ok(!code.includes("res.json()"));
  });

  it("injects bearer auth header from env or token", () => {
    const code = genApiTest({
      ...base,
      request: { method: "GET", path: "/secure", auth: { kind: "bearer", env: "API_TOKEN", token: "fallback" } },
      assert: [{ status: 200 }],
    });
    assert.ok(code.includes("spec.auth.env ? (process.env[spec.auth.env]"));
    assert.ok(code.includes('spec.auth.header || "Authorization"'));
    assert.ok(code.includes('Missing auth token'));
  });
});
