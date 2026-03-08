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
      assert.deepEqual(result.framework_recommendations.behavior, ["cucumber", "playwright-web", "playwright-request", "node-pty"]);
      assert.ok(result.framework_recommendations.technical.includes("tsarch"));
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
});
