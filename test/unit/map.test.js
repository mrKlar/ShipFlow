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
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({ impl: { srcDir: "src" } }));

      const result = buildMap(tmpDir);
      assert.ok(result.detected.ui_routes.includes("/dashboard") || result.detected.ui_routes.includes("/login"));
      assert.ok(result.detected.api_endpoints.some(e => e.includes("/api/users")));
      assert.ok(result.detected.db_tables.includes("users"));
      assert.ok(result.coverage.gaps.some(g => g.includes("UI verification")));
      assert.ok(result.coverage.gaps.some(g => g.includes("security verification")));
      assert.ok(result.recommendations.some(r => r.type === "api"));
      assert.ok(result.recommendations.some(r => r.type === "security"));
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
});
