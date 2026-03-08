import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SecurityCheck } from "../../lib/schema/security-check.zod.js";
import { securityAssertExpr, genSecurityTest } from "../../lib/gen-security.js";

const base = {
  id: "security-authz",
  title: "Unauthenticated access is rejected",
  severity: "blocker",
  category: "authz",
  app: { kind: "security", base_url: "http://localhost:3000" },
  request: { method: "GET", path: "/api/admin" },
};

describe("SecurityCheck schema", () => {
  it("accepts valid security check", () => {
    const r = SecurityCheck.parse({
      ...base,
      assert: [{ status: 401 }, { header_absent: { name: "x-internal-token" } }],
    });
    assert.equal(r.app.kind, "security");
    assert.equal(r.category, "authz");
  });

  it("defaults category to other", () => {
    const r = SecurityCheck.parse({
      ...base,
      category: undefined,
      assert: [{ status: 403 }],
    });
    assert.equal(r.category, "other");
  });

  it("accepts header and body assertions", () => {
    const r = SecurityCheck.parse({
      ...base,
      assert: [
        { status: 401 },
        { header_matches: { name: "content-type", matches: "json" } },
        { body_not_contains: "stack trace" },
      ],
    });
    assert.equal(r.assert.length, 3);
  });

  it("rejects invalid app kind", () => {
    assert.throws(() => {
      SecurityCheck.parse({
        ...base,
        app: { kind: "api", base_url: "http://localhost:3000" },
        assert: [{ status: 401 }],
      });
    });
  });
});

describe("securityAssertExpr", () => {
  it("generates status", () => {
    assert.equal(securityAssertExpr({ status: 401 }), "expect(res.status()).toBe(401);");
  });

  it("generates header_absent", () => {
    const code = securityAssertExpr({ header_absent: { name: "X-Token" } });
    assert.ok(code.includes('"x-token"'));
    assert.ok(code.includes("toBe(false)"));
  });

  it("generates body_not_contains", () => {
    const code = securityAssertExpr({ body_not_contains: "stack trace" });
    assert.ok(code.includes(".not.toContain"));
    assert.ok(code.includes('"stack trace"'));
  });
});

describe("genSecurityTest", () => {
  it("generates request-based Playwright security test", () => {
    const code = genSecurityTest({
      ...base,
      assert: [{ status: 401 }, { header_absent: { name: "x-internal-token" } }],
    });
    assert.ok(code.includes('test.describe("Security: authz"'));
    assert.ok(code.includes('{ request }'));
    assert.ok(code.includes('request.get("http://localhost:3000/api/admin")'));
    assert.ok(code.includes("toBe(401)"));
  });

  it("generates POST security test with body and headers", () => {
    const code = genSecurityTest({
      ...base,
      request: {
        method: "POST",
        path: "/api/upload",
        headers: { Authorization: "Bearer x" },
        body_json: { file: "../../etc/passwd" },
      },
      assert: [{ status: 400 }, { body_not_contains: "/etc/passwd" }],
    });
    assert.ok(code.includes("request.post("));
    assert.ok(code.includes("Authorization"));
    assert.ok(code.includes("etc/passwd"));
  });
});
