import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NfrCheck } from "../../lib/schema/nfr-check.zod.js";
import { genK6Script } from "../../lib/gen-nfr.js";

const base = {
  id: "load-homepage",
  title: "Homepage handles load",
  severity: "blocker",
  app: { kind: "nfr", base_url: "http://localhost:3000" },
};

describe("NfrCheck schema", () => {
  it("accepts valid NFR check", () => {
    const r = NfrCheck.parse({
      ...base,
      scenario: {
        endpoint: "/",
        method: "GET",
        thresholds: { http_req_duration_p95: 500 },
        vus: 50,
        duration: "30s",
      },
    });
    assert.equal(r.id, "load-homepage");
    assert.equal(r.scenario.vus, 50);
  });

  it("accepts POST with body and headers", () => {
    const r = NfrCheck.parse({
      ...base,
      scenario: {
        endpoint: "/api/data",
        method: "POST",
        headers: { Authorization: "Bearer tok" },
        body_json: { name: "test" },
        thresholds: { http_req_failed: 0.01 },
        vus: 10,
        duration: "1m",
      },
    });
    assert.equal(r.scenario.method, "POST");
    assert.deepEqual(r.scenario.body_json, { name: "test" });
  });

  it("defaults method to GET", () => {
    const r = NfrCheck.parse({
      ...base,
      scenario: {
        endpoint: "/",
        thresholds: {},
        vus: 10,
        duration: "10s",
      },
    });
    assert.equal(r.scenario.method, "GET");
  });

  it("rejects invalid duration format", () => {
    assert.throws(() => {
      NfrCheck.parse({
        ...base,
        scenario: {
          endpoint: "/",
          thresholds: {},
          vus: 10,
          duration: "invalid",
        },
      });
    });
  });

  it("rejects negative vus", () => {
    assert.throws(() => {
      NfrCheck.parse({
        ...base,
        scenario: {
          endpoint: "/",
          thresholds: {},
          vus: -1,
          duration: "10s",
        },
      });
    });
  });

  it("rejects http_req_failed > 1", () => {
    assert.throws(() => {
      NfrCheck.parse({
        ...base,
        scenario: {
          endpoint: "/",
          thresholds: { http_req_failed: 1.5 },
          vus: 10,
          duration: "10s",
        },
      });
    });
  });
});

describe("genK6Script", () => {
  const check = {
    ...base,
    scenario: {
      endpoint: "/",
      method: "GET",
      thresholds: { http_req_duration_p95: 500, http_req_failed: 0.01 },
      vus: 100,
      duration: "30s",
    },
  };

  it("generates k6 imports", () => {
    const code = genK6Script(check);
    assert.ok(code.includes('import http from "k6/http"'));
    assert.ok(code.includes('import { check } from "k6"'));
  });

  it("generates options with vus and duration", () => {
    const code = genK6Script(check);
    assert.ok(code.includes("vus: 100"));
    assert.ok(code.includes('"30s"'));
  });

  it("generates thresholds", () => {
    const code = genK6Script(check);
    assert.ok(code.includes("p(95)<500"));
    assert.ok(code.includes("rate<0.01"));
  });

  it("generates GET request", () => {
    const code = genK6Script(check);
    assert.ok(code.includes('http.get("http://localhost:3000/"'));
  });

  it("generates POST with body", () => {
    const postCheck = {
      ...base,
      scenario: {
        endpoint: "/api/data",
        method: "POST",
        body_json: { name: "test" },
        thresholds: {},
        vus: 10,
        duration: "10s",
      },
    };
    const code = genK6Script(postCheck);
    assert.ok(code.includes("http.post("));
    assert.ok(code.includes("name"));
    assert.ok(code.includes("test"));
  });

  it("generates headers when present", () => {
    const authCheck = {
      ...base,
      scenario: {
        endpoint: "/api/data",
        method: "GET",
        headers: { Authorization: "Bearer tok" },
        thresholds: {},
        vus: 10,
        duration: "10s",
      },
    };
    const code = genK6Script(authCheck);
    assert.ok(code.includes("Authorization"));
    assert.ok(code.includes("Bearer tok"));
  });

  it("generates check for status 200", () => {
    const code = genK6Script(check);
    assert.ok(code.includes("check(res"));
    assert.ok(code.includes("r.status === 200"));
  });
});
