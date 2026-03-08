import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildDraft, draft, parseAiDraftResponse, resolveDraftOptions } from "../../lib/draft.js";

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

  it("proposes request-driven verification candidates on low-signal repos", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "todo app with login, REST API, sqlite, GitHub Actions, Docker, and stress testing");
      assert.ok(result.proposals.some(proposal => proposal.type === "ui" && proposal.path.startsWith("vp/ui/")));
      assert.ok(result.proposals.some(proposal => proposal.type === "behavior" && proposal.path.startsWith("vp/behavior/")));
      const apiProposals = result.proposals.filter(proposal => proposal.type === "api" && proposal.path.startsWith("vp/api/"));
      const database = result.proposals.find(proposal => proposal.type === "database" && proposal.path === "vp/db/requested-sqlite-data-lifecycle.yml");
      const performanceProposals = result.proposals.filter(proposal => proposal.type === "performance" && proposal.path.startsWith("vp/nfr/"));
      assert.equal(apiProposals.length, 3);
      assert.ok(apiProposals.some(proposal => proposal.path === "vp/api/requested-post-api-login.yml"));
      assert.ok(apiProposals.some(proposal => proposal.path === "vp/api/requested-get-api-todos.yml"));
      assert.ok(apiProposals.some(proposal => proposal.path === "vp/api/requested-post-api-todos.yml"));
      const loginApi = apiProposals.find(proposal => proposal.path === "vp/api/requested-post-api-login.yml");
      const todosReadApi = apiProposals.find(proposal => proposal.path === "vp/api/requested-get-api-todos.yml");
      assert.ok(loginApi);
      assert.deepEqual(loginApi.data.request.body_json, { email: "user@example.com", password: "secret123" });
      assert.ok(loginApi.data.assert.some(item => item.json_type?.type === "object"));
      assert.ok(todosReadApi);
      assert.ok(todosReadApi.data.assert.some(item => item.json_type?.type === "array"));
      assert.ok(database);
      assert.match(database.data.setup_sql, /CREATE TABLE IF NOT EXISTS todos/);
      assert.match(database.data.cleanup_sql, /DROP TABLE IF EXISTS todos/);
      assert.equal(performanceProposals.length, 2);
      assert.ok(performanceProposals.some(proposal => proposal.path === "vp/nfr/requested-baseline-api-todos.yml"));
      const stressProfile = performanceProposals.find(proposal => proposal.path === "vp/nfr/requested-stress-api-todos.yml");
      assert.ok(stressProfile);
      assert.equal(stressProfile.data.scenario.profile, "stress");
      assert.equal(stressProfile.data.scenario.method, "GET");
      assert.equal(stressProfile.data.scenario.stages.length, 3);
      assert.ok(result.proposals.some(proposal => proposal.type === "technical" && proposal.path === "vp/technical/requested-delivery-stack.yml"));
      assert.ok(result.proposals.some(proposal => proposal.type === "technical" && proposal.path === "vp/technical/requested-framework-stack.yml") === false);
    });
  });

  it("proposes a PostgreSQL starter when the request names postgres", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "REST API with postgres and GitHub Actions");
      const database = result.proposals.find(proposal => proposal.path === "vp/db/requested-postgresql-data-lifecycle.yml");
      assert.ok(database);
      assert.equal(database.data.app.engine, "postgresql");
      assert.match(database.data.setup_sql, /DROP TABLE IF EXISTS/);
      assert.match(database.data.cleanup_sql, /DROP TABLE IF EXISTS/);
    });
  });

  it("categorizes request-driven admin security starters as authz", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "admin API with role permissions");
      const security = result.proposals.find(proposal => proposal.type === "security");
      assert.ok(security);
      assert.equal(security.data.category, "authz");
    });
  });

  it("infers profile-style security starters for authn requests", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "app with login and profile");
      const security = result.proposals.find(proposal => proposal.type === "security");
      assert.ok(security);
      assert.equal(security.data.category, "authn");
      assert.equal(security.data.request.path, "/api/profile");
    });
  });
});

describe("draft", () => {
  it("parses AI draft JSON even when wrapped in markdown fences", () => {
    const parsed = parseAiDraftResponse('Draft:\n```json\n{"summary":"ok","proposals":[]}\n```\n');
    assert.equal(parsed.summary, "ok");
    assert.deepEqual(parsed.proposals, []);
  });

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

  it("writes medium and high confidence verification candidates with --write", async () => {
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
      assert.ok(result.written.some(file => file.startsWith("vp/api/")));
      assert.ok(result.written.some(file => file.startsWith("vp/security/")));
      assert.ok(result.written.some(file => file.startsWith("vp/technical/")));
      assert.ok(!result.written.some(file => file.startsWith("vp/behavior/")));
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

  it("does not write invalid AI verification proposals", async () => {
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

  it("keeps warning-prone verification candidates out of auto-write while still surfacing them", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const { result } = await draft({
        cwd: tmpDir,
        input: "todo app with login and sqlite",
        write: true,
        json: false,
      });

      const behavior = result.proposals.find(proposal => proposal.path.startsWith("vp/behavior/"));
      const database = result.proposals.find(proposal => proposal.path === "vp/db/requested-sqlite-data-lifecycle.yml");
      assert.equal(behavior.validation.auto_write, false);
      assert.equal(database.validation.auto_write, true);
      assert.ok(!result.written.some(file => file.startsWith("vp/behavior/")));
      assert.ok(result.written.includes("vp/db/requested-sqlite-data-lifecycle.yml"));
      assert.ok(result.proposal_validation.needs_review >= 1);
    });
  });

  it("persists draft review decisions and writes only accepted proposals when review exists", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      await draft({
        cwd: tmpDir,
        input: "todo app with login and sqlite",
        json: false,
      });

      const sessionFile = path.join(tmpDir, ".shipflow", "draft-session.json");
      assert.ok(fs.existsSync(sessionFile));

      const acceptedPath = "vp/db/requested-sqlite-data-lifecycle.yml";
      const rejectedPath = "vp/security/requested-protection-api-me.yml";
      const reviewed = await draft({
        cwd: tmpDir,
        input: "todo app with login and sqlite",
        json: false,
        accept: [acceptedPath],
        reject: [rejectedPath],
      });

      assert.equal(reviewed.result.review_updates.accepted, 1);
      assert.equal(reviewed.result.review_updates.rejected, 1);

      const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      const accepted = session.proposals.find(proposal => proposal.path === acceptedPath);
      const rejected = session.proposals.find(proposal => proposal.path === rejectedPath);
      assert.equal(accepted.review.decision, "accept");
      assert.equal(rejected.review.decision, "reject");

      const followUp = await draft({
        cwd: tmpDir,
        input: "todo app with login and sqlite",
        json: false,
      });
      const persistedAccepted = followUp.result.proposals.find(proposal => proposal.path === acceptedPath);
      const persistedRejected = followUp.result.proposals.find(proposal => proposal.path === rejectedPath);
      assert.equal(persistedAccepted.review.decision, "accept");
      assert.equal(persistedRejected.review.decision, "reject");

      const written = await draft({
        cwd: tmpDir,
        input: "todo app with login and sqlite",
        write: true,
        json: false,
      });
      assert.ok(written.result.written.includes(acceptedPath));
      assert.ok(!written.result.written.includes(rejectedPath));
      assert.equal(written.result.written.length, 1);
    });
  });

  it("reuses the saved draft request when no new input is provided", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      await draft({
        cwd: tmpDir,
        input: "todo app with login and sqlite",
        json: false,
      });

      const acceptedPath = "vp/db/requested-sqlite-data-lifecycle.yml";
      const followUp = await draft({
        cwd: tmpDir,
        json: false,
        accept: [acceptedPath],
      });

      assert.equal(followUp.result.request.raw, "todo app with login and sqlite");
      const accepted = followUp.result.proposals.find(proposal => proposal.path === acceptedPath);
      assert.equal(accepted.review.decision, "accept");
    });
  });

  it("updates an existing verification only when explicitly allowed", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "vp", "api"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "api", "existing-users.yml"), [
        "id: api-existing-users",
        "title: Old API contract",
        "severity: blocker",
        "app:",
        "  kind: api",
        "  base_url: http://localhost:3000",
        "request:",
        "  method: GET",
        "  path: /api/users",
        "assert:",
        "  - status: 200",
        "",
      ].join("\n"));
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        draft: {
          provider: "command",
        },
      }));

      const generateText = async () => JSON.stringify({
        summary: "AI proposed a stronger API contract",
        proposals: [{
          type: "api",
          path: "vp/api/existing-users.yml",
          confidence: "high",
          reason: "Tighten the existing API verification",
          data: {
            id: "api-existing-users",
            title: "Updated API contract",
            severity: "blocker",
            app: { kind: "api", base_url: "http://localhost:3000" },
            request: { method: "GET", path: "/api/users" },
            assert: [{ status: 200 }, { header_matches: { name: "content-type", matches: "json" } }],
          },
        }],
      });

      const protectedWrite = await draft({
        cwd: tmpDir,
        json: false,
        write: true,
        accept: ["vp/api/existing-users.yml"],
        generateText,
      });
      assert.ok(!protectedWrite.result.written.includes("vp/api/existing-users.yml"));
      assert.match(fs.readFileSync(path.join(tmpDir, "vp", "api", "existing-users.yml"), "utf-8"), /Old API contract/);

      const updatedWrite = await draft({
        cwd: tmpDir,
        json: false,
        write: true,
        accept: ["vp/api/existing-users.yml"],
        updateExisting: true,
        generateText,
      });
      assert.ok(updatedWrite.result.written.includes("vp/api/existing-users.yml"));
      assert.match(fs.readFileSync(path.join(tmpDir, "vp", "api", "existing-users.yml"), "utf-8"), /Updated API contract/);
    });
  });
});
