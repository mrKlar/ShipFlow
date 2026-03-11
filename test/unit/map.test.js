import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildMap } from "../../lib/map.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-map-"));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("buildMap", () => {
  it("detects routes, APIs, DB usage and recommends missing VP types", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), `
        app.get("/dashboard", handler);
        app.post("/api/users", handler);
        const link = '<a href="/login">Login</a>';
        const sql = "SELECT * FROM users";
        const auth = "jwt token password";
        const sec = "Content-Security-Policy";
      `);
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "behavior"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "api"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "db"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "nfr"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "security"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "technical"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({ impl: { srcDir: "src" } }));
      fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".github", "workflows", "ci.yml"), "name: ci\n");

      const result = buildMap(tmpDir);
      assert.ok(result.detected.ui_routes.includes("/dashboard") || result.detected.ui_routes.includes("/login"));
      assert.ok(result.detected.api_endpoints.some(e => e.includes("/api/users")));
      assert.ok(result.detected.db_tables.includes("users"));
      assert.ok(result.coverage.gaps.some(g => g.includes("UI verification")));
      assert.ok(result.coverage.gaps.some(g => g.includes("security verification")));
      assert.ok(result.coverage.gaps.some(g => g.includes("technical verification")));
      assert.ok(result.recommendations.some(r => r.type === "api"));
      assert.ok(result.recommendations.some(r => r.type === "security"));
      assert.ok(result.recommendations.some(r => r.type === "technical"));
      assert.ok(result.detected.technical_files.includes(".github/workflows"));
      assert.deepEqual(result.framework_recommendations.behavior, ["cucumber", "playwright-browser", "playwright-api", "pty-harness"]);
      assert.deepEqual(result.framework_recommendations.api, ["playwright-api", "pactum"]);
      assert.ok(result.framework_recommendations.technical.includes("tsarch"));
    });
  });

  it("infers a stateful fullstack web archetype and baseline bundle from repo signals", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), `
        app.get("/calculator", handler);
        app.post("/api/calculate", handler);
        const sql = "SELECT * FROM calculation_history";
      `);

      const result = buildMap(tmpDir);
      assert.equal(result.project.app_archetype, "fullstack-web-stateful");
      assert.deepEqual(result.project.verification_bundle.required_types, ["ui", "behavior", "domain", "api", "database", "technical"]);
      assert.deepEqual(result.project.verification_bundle.missing_required_types, ["ui", "behavior", "domain", "api", "database", "technical"]);
      assert.ok(result.coverage.gaps.some(gap => gap.includes("baseline bundle")));
      assert.ok(result.recommendations.some(rec => rec.type === "technical" && rec.summary.includes("runtime and dependency")));
    });
  });

  it("uses configured srcDir when present", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "frontend"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "frontend", "app.tsx"), `const link = '<a href="/home">Home</a>';`);
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({ impl: { srcDir: "frontend" } }));

      const result = buildMap(tmpDir);
      assert.deepEqual(result.project.source_roots, ["frontend"]);
      assert.ok(result.detected.ui_routes.includes("/home"));
    });
  });

  it("detects UI routes from Next-style page files", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "app", "dashboard"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "app", "dashboard", "page.tsx"), "export default function Dashboard() { return null; }\n");

      const result = buildMap(tmpDir);
      assert.ok(result.detected.ui_routes.includes("/dashboard"));
    });
  });

  it("adds request-driven gaps, recommendations, and ambiguities", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), "export const ok = true;\n");

      const result = buildMap(tmpDir, "todo app with login, REST API, postgres, load test, and CI");
      assert.deepEqual(result.request.inferred_types, ["behavior", "ui", "api", "database", "performance", "security", "technical"]);
      assert.ok(result.request.gaps.some(gap => gap.includes("ui coverage")));
      assert.ok(result.request.gaps.some(gap => gap.includes("technical checks")));
      assert.ok(result.ambiguities.some(item => item.includes("no concrete endpoint")));
      assert.ok(result.ambiguities.some(item => item.includes("no concrete routes")));
      assert.ok(result.recommendations.some(rec => rec.type === "api" && rec.summary.includes("requested endpoints")));
      assert.ok(result.recommendations.some(rec => rec.type === "technical" && rec.summary.includes("requested technical scope")));
    });
  });

  it("infers a CLI/TUI archetype from a greenfield request", () => {
    withTmpDir(tmpDir => {
      const result = buildMap(tmpDir, "CLI todo app with sqlite history");
      assert.equal(result.request.app_archetype, "cli-tui-stateful");
      assert.deepEqual(result.request.verification_bundle.required_types, ["behavior", "domain", "database", "technical"]);
      assert.deepEqual(result.request.verification_bundle.missing_required_types, ["behavior", "domain", "database", "technical"]);
      assert.ok(result.request.gaps.some(gap => gap.includes("baseline bundle")));
      assert.ok(result.recommendations.some(rec => rec.type === "database"));
    });
  });

  it("infers a REST backend service archetype for API-only services with persistence and upstream fan-out", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "service.js"), `
        app.post("/quotes", async (req, res) => {
          const pricing = await fetch("https://pricing.example.com/v1/quote");
          const risk = await axios.post("https://risk.example.com/check");
          const sql = "INSERT INTO quote_history";
          return res.json({ ok: true });
        });
      `);

      const result = buildMap(tmpDir);
      assert.equal(result.project.app_archetype, "rest-service");
      assert.deepEqual(result.project.verification_bundle.required_types, ["behavior", "domain", "api", "database", "technical"]);
      assert.ok(result.project.verification_bundle.label.includes("REST backend service"));
      assert.ok(result.detected.api_endpoints.includes("POST /quotes"));
      assert.deepEqual(result.detected.external_api_hosts, ["pricing.example.com", "risk.example.com"]);
      assert.ok(result.coverage.gaps.some(gap => gap.includes("baseline bundle")));
      assert.ok(result.ambiguities.some(item => item.includes("Multiple upstream API hosts")));
      assert.ok(result.recommendations.some(rec => rec.type === "api" && rec.summary.includes("upstream failure handling")));
    });
  });

  it("infers a request-only REST backend service archetype without forcing database coverage", () => {
    withTmpDir(tmpDir => {
      const result = buildMap(tmpDir, "REST service that aggregates multiple partner APIs behind one backend endpoint");
      assert.equal(result.request.app_archetype, "rest-service");
      assert.deepEqual(result.request.verification_bundle.required_types, ["behavior", "domain", "api", "technical"]);
      assert.ok(result.request.gaps.some(gap => gap.includes("baseline bundle")));
    });
  });

  it("detects CLI/TUI signals and behavior gaps", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "cli.js"), `
        import readline from "node:readline";
        process.stdin.resume();
      `);

      const result = buildMap(tmpDir, "terminal todo app with a CLI");
      assert.ok(result.detected.tui_signals > 0);
      assert.ok(result.coverage.gaps.some(gap => gap.includes("behavior verification")));
      assert.equal(result.ambiguities.some(item => item.includes("terminal entrypoint")), false);
    });
  });

  it("detects an exclusive GraphQL protocol from brownfield code", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "app", "api", "graphql"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.ts"), `
        import { createYoga } from "graphql-yoga";
        export const yoga = createYoga({ graphqlEndpoint: "/graphql" });
      `);
      fs.writeFileSync(path.join(tmpDir, "app", "api", "graphql", "route.ts"), `
        export async function POST() { return Response.json({ ok: true }); }
      `);

      const result = buildMap(tmpDir);
      assert.ok(result.detected.api_endpoints.includes("POST /api/graphql"));
      assert.equal(result.detected.protocols.graphql.detected, true);
      assert.equal(result.detected.protocols.rest.detected, false);
      assert.ok(result.detected.protocols.graphql.endpoints.includes("/graphql"));
      assert.ok(result.recommendations.some(rec => rec.type === "technical" && rec.summary.includes("GraphQL surface")));
    });
  });

  it("detects an exclusive REST protocol from Next API route files", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "app", "api", "users"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "app", "api", "users", "route.ts"), `
        export async function GET() { return Response.json([{ id: 1 }]); }
      `);

      const result = buildMap(tmpDir);
      assert.ok(result.detected.api_endpoints.includes("GET /api/users"));
      assert.equal(result.detected.protocols.rest.detected, true);
      assert.equal(result.detected.protocols.graphql.detected, false);
      assert.ok(result.detected.protocols.rest.endpoints.includes("/api/users"));
      assert.ok(result.recommendations.some(rec => rec.type === "technical" && rec.summary.includes("REST surface")));
    });
  });
});
