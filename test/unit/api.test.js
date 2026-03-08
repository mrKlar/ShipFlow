import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiCheck } from "../../lib/schema/api-check.zod.js";
import { apiAssertExpr, genApiSpec } from "../../lib/gen-api.js";

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
        { body_contains: "hello" },
        { json_equals: { path: "$.name", equals: "Alice" } },
        { json_matches: { path: "$.status", matches: "active" } },
        { json_count: { path: "$", count: 5 } },
      ],
    });
    assert.equal(r.assert.length, 7);
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

  it("generates json_equals", () => {
    const r = apiAssertExpr({ json_equals: { path: "$[0].name", equals: "Alice" } });
    assert.equal(r, 'expect(body[0].name).toBe("Alice");');
  });

  it("generates json_matches", () => {
    const r = apiAssertExpr({ json_matches: { path: "$.status", matches: "active" } });
    assert.ok(r.includes("body.status"));
    assert.ok(r.includes("toMatch"));
  });

  it("generates json_count", () => {
    const r = apiAssertExpr({ json_count: { path: "$", count: 3 } });
    assert.equal(r, "expect(body).toHaveLength(3);");
  });

  it("throws on unknown assert", () => {
    assert.throws(() => apiAssertExpr({ unknown: {} }), /Unknown API assert/);
  });
});

describe("genApiSpec", () => {
  it("generates GET request", () => {
    const spec = genApiSpec({ ...base, assert: [{ status: 200 }] });
    assert.ok(spec.includes("request.get("));
    assert.ok(spec.includes('"http://localhost:3000/api/users"'));
    assert.ok(spec.includes("toBe(200)"));
  });

  it("generates POST with body_json", () => {
    const check = {
      ...base,
      request: { method: "POST", path: "/api/users", body_json: { name: "Bob" } },
      assert: [{ status: 201 }],
    };
    const spec = genApiSpec(check);
    assert.ok(spec.includes("request.post("));
    assert.ok(spec.includes('"name":"Bob"'));
  });

  it("generates headers", () => {
    const check = {
      ...base,
      request: { method: "GET", path: "/x", headers: { Authorization: "Bearer tok" } },
      assert: [],
    };
    const spec = genApiSpec(check);
    assert.ok(spec.includes("Authorization"));
    assert.ok(spec.includes("Bearer tok"));
  });

  it("parses JSON body when json assertions exist", () => {
    const check = {
      ...base,
      assert: [{ json_equals: { path: "$.name", equals: "Alice" } }],
    };
    const spec = genApiSpec(check);
    assert.ok(spec.includes("await res.json()"));
    assert.ok(spec.includes("body.name"));
  });

  it("does not parse JSON when only status check", () => {
    const spec = genApiSpec({ ...base, assert: [{ status: 200 }] });
    assert.ok(!spec.includes("res.json()"));
  });
});
