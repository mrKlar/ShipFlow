import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildDraft, draft, resolveDraftOptions } from "../../lib/draft.js";

async function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-draft-"));
  try {
    await fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("buildDraft", () => {
  it("proposes starter files from map signals", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "behavior"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "api"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "db"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "nfr"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "security"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "technical"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), `
        app.get("/dashboard", handler);
        app.get("/api/users", handler);
        const link = '<a href="/login">Login</a>';
        const sql = "SELECT * FROM users";
        const token = req.headers.authorization;
      `);
      fs.writeFileSync(path.join(tmpDir, ".github", "workflows", "ci.yml"), "uses: actions/checkout@v4\n");
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        devDependencies: { "@playwright/test": "^1.0.0", "tsarch": "^0.1.0" },
      }));

      const result = buildDraft(tmpDir);
      assert.ok(result.proposals.some(p => p.type === "ui"));
      assert.ok(result.proposals.some(p => p.type === "behavior"));
      assert.ok(result.proposals.some(p => p.type === "api"));
      assert.ok(result.proposals.some(p => p.type === "database"));
      assert.ok(result.proposals.some(p => p.type === "security"));
      assert.ok(result.proposals.some(p => p.type === "technical"));
      assert.ok(result.proposals.some(p => p.path.startsWith("vp/nfr/")));
      assert.ok(result.ambiguities.length > 0);
    });
  });

  it("tracks request-driven coverage gaps and ambiguities", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "todo app with login, REST API, postgres, and CI");
      assert.deepEqual(result.request.inferred_types, ["behavior", "ui", "api", "database", "security", "technical"]);
      assert.ok(result.request.gaps.some(gap => gap.includes("api")));
      assert.ok(result.request.gaps.some(gap => gap.includes("security")));
      assert.ok(result.ambiguities.some(item => item.includes("no concrete endpoint")));
      assert.ok(result.ambiguities.some(item => item.includes("no concrete routes")));
    });
  });

  it("proposes request-driven starter files on low-signal repos", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "todo app with login, REST API, sqlite, GitHub Actions, and Docker");
      assert.ok(result.proposals.some(proposal => proposal.type === "ui" && proposal.path.startsWith("vp/ui/")));
      assert.ok(result.proposals.some(proposal => proposal.type === "behavior" && proposal.path.startsWith("vp/behavior/")));
      assert.ok(result.proposals.some(proposal => proposal.type === "api" && proposal.path.startsWith("vp/api/")));
      assert.ok(result.proposals.some(proposal => proposal.type === "database" && proposal.path === "vp/db/requested-sqlite-smoke.yml"));
      assert.ok(result.proposals.some(proposal => proposal.type === "technical" && proposal.path === "vp/technical/requested-delivery-stack.yml"));
      assert.ok(result.proposals.some(proposal => proposal.type === "technical" && proposal.path === "vp/technical/requested-framework-stack.yml") === false);
    });
  });
});

describe("draft", () => {
  it("keeps local drafting by default but auto-resolves the AI provider", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, ".gemini"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".gemini", "settings.json"), "{}\n");
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        draft: {
          provider: "local",
          aiProvider: "auto",
        },
      }));

      const options = resolveDraftOptions(tmpDir, {}, {
        commandExists: cmd => cmd === "gemini",
      });
      assert.equal(options.provider, "local");
      assert.equal(options.aiProvider, "gemini");
      assert.equal(options.model, "gemini-2.5-pro");
    });
  });

  it("writes medium and high confidence starter files with --write", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
      for (const dir of ["ui", "behavior", "api", "db", "nfr", "security", "technical"]) {
        fs.mkdirSync(path.join(tmpDir, "vp", dir), { recursive: true });
      }
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), `
        app.get("/api/users", handler);
        const link = '<a href="/home">Home</a>';
        const sql = "SELECT * FROM users";
        const token = req.headers.authorization;
      `);
      fs.writeFileSync(path.join(tmpDir, ".github", "workflows", "ci.yml"), "uses: actions/checkout@v4\n");
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }));

      const { result } = await draft({ cwd: tmpDir, write: true, json: false });
      assert.ok(result.written.some(file => file.startsWith("vp/ui/")));
      assert.ok(result.written.some(file => file.startsWith("vp/behavior/")));
      assert.ok(result.written.some(file => file.startsWith("vp/api/")));
      assert.ok(result.written.some(file => file.startsWith("vp/security/")));
      assert.ok(result.written.some(file => file.startsWith("vp/technical/")));
      assert.ok(fs.existsSync(path.join(tmpDir, result.written[0])));
    });
  });

  it("merges AI draft proposals through the command provider", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      for (const dir of ["ui", "behavior", "api", "db", "nfr", "security", "technical"]) {
        fs.mkdirSync(path.join(tmpDir, "vp", dir), { recursive: true });
      }
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), `app.get("/api/users", handler);`);
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        draft: {
          provider: "command",
        },
      }));

      const { result } = await draft({
        cwd: tmpDir,
        json: false,
        generateText: async () => JSON.stringify({
          summary: "AI refined coverage",
          proposals: [{
            type: "api",
            path: "vp/api/ai-users.yml",
            confidence: "high",
            reason: "AI found a better API contract",
            data: {
              id: "api-ai-users",
              title: "AI API contract",
              severity: "blocker",
              app: { kind: "api", base_url: "http://localhost:3000" },
              request: { method: "GET", path: "/api/users" },
              assert: [{ status: 200 }],
            },
          }],
        }),
      });
      assert.ok(result.ai.enabled);
      assert.equal(result.ai.provider, "command");
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/api/ai-users.yml" && proposal.source === "ai"));
      assert.equal(result.proposal_validation.invalid, 0);
    });
  });

  it("does not write invalid AI starter proposals", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      for (const dir of ["ui", "behavior", "api", "db", "nfr", "security", "technical"]) {
        fs.mkdirSync(path.join(tmpDir, "vp", dir), { recursive: true });
      }
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), `app.get("/api/users", handler);`);
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        draft: {
          provider: "command",
        },
      }));

      const { result } = await draft({
        cwd: tmpDir,
        write: true,
        json: false,
        generateText: async () => JSON.stringify({
          summary: "AI returned one invalid proposal",
          proposals: [{
            type: "api",
            path: "vp/api/invalid-users.yml",
            confidence: "high",
            reason: "Missing the required app.kind value",
            data: {
              id: "api-invalid-users",
              title: "Broken API proposal",
              severity: "blocker",
              app: { base_url: "http://localhost:3000" },
              request: { method: "GET", path: "/api/users" },
              assert: [{ status: 200 }],
            },
          }],
        }),
      });

      const invalid = result.proposals.find(proposal => proposal.path === "vp/api/invalid-users.yml");
      assert.equal(result.proposal_validation.invalid, 1);
      assert.equal(invalid.validation.ok, false);
      assert.ok(invalid.validation.issues.some(issue => issue.code === "schema.invalid"));
      assert.ok(!fs.existsSync(path.join(tmpDir, "vp", "api", "invalid-users.yml")));
    });
  });

  it("passes the user request into AI draft refinement", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "vp", "behavior"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        draft: {
          provider: "command",
        },
      }));

      let capturedPrompt = "";
      await draft({
        cwd: tmpDir,
        input: "todo app with login and admin API",
        json: false,
        generateText: async ({ prompt }) => {
          capturedPrompt = prompt;
          return JSON.stringify({ summary: "ok", proposals: [] });
        },
      });

      assert.ok(capturedPrompt.includes("todo app with login and admin API"));
      assert.ok(capturedPrompt.includes("\"inferred_types\""));
    });
  });
});
