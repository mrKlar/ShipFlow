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
      fs.mkdirSync(path.join(tmpDir, "src", "domain"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "src", "ui"), { recursive: true });
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
      fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "esnext" } }));
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        packageManager: "pnpm@9.0.0",
        scripts: {
          build: "next build",
          "test:e2e": "playwright test",
        },
        devDependencies: { "@playwright/test": "^1.0.0", "tsarch": "^0.1.0" },
      }));

      const result = buildDraft(tmpDir);
      assert.ok(result.proposals.some(p => p.type === "ui"));
      assert.ok(result.proposals.some(p => p.type === "behavior"));
      assert.ok(result.proposals.some(p => p.type === "api"));
      assert.ok(result.proposals.some(p => p.type === "database"));
      assert.ok(result.proposals.some(p => p.type === "security"));
      assert.ok(result.proposals.some(p => p.type === "technical"));
      const architecture = result.proposals.find(p => p.path === "vp/technical/architecture-boundaries.yml");
      assert.ok(architecture);
      assert.equal(architecture.data.runner.framework, "tsarch");
      assert.ok(architecture.data.assert.some(item => item.no_circular_dependencies));
      const framework = result.proposals.find(p => p.path === "vp/technical/framework-stack.yml");
      assert.ok(framework);
      assert.ok(framework.data.assert.some(item => item.json_matches?.query === "$.packageManager"));
      assert.ok(framework.data.assert.some(item => item.script_present?.name === "build"));
      assert.equal(framework.data.assert.some(item => item.path_exists?.path === "playwright.config.ts"), false);
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

  it("builds per-type discussion prompts with best practices", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), `
        app.get("/calculator", handler);
        app.get("/api/problems", handler);
        const sql = "SELECT * FROM worksheets";
        const token = req.headers.authorization;
      `);

      const result = buildDraft(tmpDir, "calculator app with UI, API, SQLite, performance, and security");
      assert.equal(result.type_discussion.length, 7);
      const ui = result.type_discussion.find(item => item.type === "ui");
      const api = result.type_discussion.find(item => item.type === "api");
      const database = result.type_discussion.find(item => item.type === "database");
      assert.ok(ui.recommended);
      assert.equal(ui.priority, "primary");
      assert.match(ui.question, /Do we want UI checks/i);
      assert.ok(ui.best_practices.some(item => /stable selectors/i.test(item)));
      assert.ok(api.signals.some(item => /Detected API endpoints/i.test(item)));
      assert.ok(database.best_practices.some(item => /setup, before\/after assertions, and cleanup/i.test(item)));
    });
  });

  it("uses a greenfield shape-first conversation mode on empty repos", () => {
    return withTmpDir(tmpDir => {
      const result = buildDraft(tmpDir, "calculator");
      assert.equal(result.conversation_mode, "greenfield-shape-first");
      assert.equal(result.opening_questions.length, 1);
      assert.match(result.opening_questions[0], /web app|api|cli\/tui|what form should this take/i);
      assert.equal(result.workflow.next_action, "ask-next-question");
      assert.equal(result.workflow.next_question, result.opening_questions[0]);
    });
  });

  it("proposes only foundational technical starters on low-signal greenfield repos", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "todo app with login, REST API, sqlite, GitHub Actions, Docker, and stress testing");
      const apiProtocol = result.proposals.find(proposal => proposal.path === "vp/technical/api-protocol.yml");
      const sqliteRuntime = result.proposals.find(proposal => proposal.path === "vp/technical/sqlite-runtime.yml");
      assert.ok(apiProtocol);
      assert.ok(apiProtocol.data.assert.some(item => item.rest_api_present));
      assert.ok(sqliteRuntime);
      assert.ok(result.proposals.some(proposal => proposal.type === "technical" && proposal.path === "vp/technical/delivery-stack.yml"));
      assert.equal(result.proposals.some(proposal => proposal.type === "ui"), false);
      assert.equal(result.proposals.some(proposal => proposal.type === "behavior"), false);
      assert.equal(result.proposals.some(proposal => proposal.type === "api"), false);
      assert.equal(result.proposals.some(proposal => proposal.type === "database"), false);
      assert.equal(result.proposals.some(proposal => proposal.type === "performance"), false);
      assert.equal(result.proposals.some(proposal => proposal.type === "security"), false);
      assert.equal(result.proposals.some(proposal => proposal.type === "technical" && proposal.path === "vp/technical/framework-stack.yml"), false);
    });
  });

  it("does not infer a UI route from sqlite file paths mentioned in the request", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "A todo app with a browser UI, a REST API, and SQLite storage in ./test.db");
      assert.equal(result.proposals.some(proposal => proposal.type === "ui"), false);
      assert.equal(result.proposals.some(proposal => proposal.path === "vp/ui/route-test.yml"), false);
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/technical/api-protocol.yml"));
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/technical/sqlite-runtime.yml"));
    });
  });

  it("drafts richer todo verification starters when the request names add, complete, and filter flows", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(
        tmpDir,
        [
          "A todo app with a browser UI, a REST API, and SQLite storage.",
          "Required capabilities:",
          "- users can add todos",
          "- users can mark todos complete",
          "- users can filter todos by status",
          "- the app exposes REST endpoints under /api/todos",
          "- todos persist in SQLite at ./test.db",
        ].join("\n"),
      );

      assert.ok(result.proposals.some(proposal => proposal.path === "vp/ui/add-todo.yml"));
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/ui/complete-todo.yml"));
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/ui/filter-todos.yml"));
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/behavior/get-api-todos-flow.yml"));
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/api/get-todos.yml"));
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/api/post-todos.yml"));
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/db/todos-state.yml"));

      const addTodo = result.proposals.find(proposal => proposal.path === "vp/ui/add-todo.yml");
      const behavior = result.proposals.find(proposal => proposal.path === "vp/behavior/get-api-todos-flow.yml");
      const createTodo = result.proposals.find(proposal => proposal.path === "vp/api/post-todos.yml");
      const database = result.proposals.find(proposal => proposal.path === "vp/db/todos-state.yml");

      assert.equal(addTodo.data.severity, "blocker");
      assert.equal(behavior.data.severity, "blocker");
      assert.equal(createTodo.data.severity, "blocker");
      assert.equal(createTodo.data.assert.some(item => item.status === 201), true);
      assert.ok(createTodo.data.assert.some(item => item.json_equals?.path === "$.title"));
      assert.match(database.data.before_query, /PRAGMA table_info\(todos\)/);
      assert.match(database.data.setup_sql, /completed INTEGER NOT NULL DEFAULT 0/);
      assert.equal(database.data.cleanup_sql, "DELETE FROM todos;");
    });
  });

  it("keeps vague PostgreSQL requests at the technical foundation layer on greenfield repos", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "REST API with postgres and GitHub Actions");
      assert.equal(result.proposals.some(proposal => proposal.type === "database"), false);
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/technical/api-protocol.yml"));
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/technical/delivery-stack.yml"));
    });
  });

  it("categorizes explicit admin security starters as authz", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "admin API at /api/admin with role permissions");
      const security = result.proposals.find(proposal => proposal.type === "security");
      assert.ok(security);
      assert.equal(security.data.category, "authz");
    });
  });

  it("infers profile-style security starters when the protected path is explicit", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "app with login and protected profile API at /api/profile");
      const security = result.proposals.find(proposal => proposal.type === "security");
      assert.ok(security);
      assert.equal(security.data.category, "authn");
      assert.equal(security.data.request.path, "/api/profile");
    });
  });

  it("proposes API behavior starters when the request gives an explicit API surface", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "API behavior for /api/users");
      const behavior = result.proposals.find(proposal => proposal.type === "behavior");
      assert.ok(behavior);
      assert.equal(behavior.data.app.kind, "api");
      assert.ok(Array.isArray(behavior.data.when));
      assert.ok(behavior.data.when[0].request);
    });
  });

  it("proposes UI and behavior starters from Next-style page files", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "app", "dashboard"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "app", "dashboard", "page.tsx"), "export default function Dashboard() { return null; }\n");

      const result = buildDraft(tmpDir);
      assert.ok(result.proposals.some(proposal => proposal.type === "ui" && proposal.path === "vp/ui/route-dashboard.yml"));
      assert.ok(result.proposals.some(proposal => proposal.type === "behavior" && proposal.path === "vp/behavior/main-flow-dashboard.yml"));
    });
  });

  it("proposes technical stack assertions for GraphQL requests", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "Next.js app with GraphQL, pnpm, and GitHub Actions");
      const technical = result.proposals.find(proposal => proposal.type === "technical" && proposal.path === "vp/technical/framework-stack.yml");
      assert.ok(technical);
      assert.ok(technical.data.assert.some(item => item.dependency_present?.name === "next"));
      assert.ok(technical.data.assert.some(item => item.dependency_present?.name === "graphql"));
      assert.ok(technical.data.assert.some(item => item.json_matches?.query === "$.packageManager"));
    });
  });

  it("keeps request-driven technical protocol proposals even when package.json already yields technical checks", () => {
    return withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        name: "tmp",
        private: true,
        scripts: { dev: "node src/server.js" },
        devDependencies: { "@playwright/test": "^1.0.0" },
      }));
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "A todo app with a browser UI, a REST API, and SQLite storage in ./test.db");
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/technical/framework-stack.yml"));
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/technical/api-protocol.yml"));
      assert.ok(result.proposals.some(proposal => proposal.path === "vp/technical/sqlite-runtime.yml"));
    });
  });

  it("proposes GraphQL protocol assertions when the request forbids REST", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "GraphQL API instead of REST");
      assert.ok(result.request.inferred_types.includes("technical"));
      const technical = result.proposals.find(proposal => proposal.path === "vp/technical/api-protocol.yml");
      assert.ok(technical);
      assert.ok(technical.data.assert.some(item => item.graphql_surface_present));
      assert.ok(technical.data.assert.some(item => item.rest_api_absent));
    });
  });

  it("proposes REST protocol assertions when the request forbids GraphQL", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = buildDraft(tmpDir, "REST API instead of GraphQL");
      assert.ok(result.request.inferred_types.includes("technical"));
      const technical = result.proposals.find(proposal => proposal.path === "vp/technical/api-protocol.yml");
      assert.ok(technical);
      assert.ok(technical.data.assert.some(item => item.rest_api_present));
      assert.ok(technical.data.assert.some(item => item.graphql_surface_absent));
    });
  });

  it("proposes a repo-driven GraphQL protocol check from detected server code", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "app", "api", "graphql"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.ts"), `
        import { createYoga } from "graphql-yoga";
        export const yoga = createYoga({ graphqlEndpoint: "/graphql" });
      `);
      fs.writeFileSync(path.join(tmpDir, "app", "api", "graphql", "route.ts"), `
        export async function POST() { return Response.json({ ok: true }); }
      `);

      const result = buildDraft(tmpDir);
      const technical = result.proposals.find(proposal => proposal.path === "vp/technical/api-protocol.yml");
      assert.ok(technical);
      assert.ok(technical.data.assert.some(item => item.graphql_surface_present));
      assert.ok(technical.data.assert.some(item => item.rest_api_absent));
    });
  });

  it("proposes a repo-driven REST protocol check from detected route files", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "app", "api", "users"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "app", "api", "users", "route.ts"), `
        export async function GET() { return Response.json([{ id: 1 }]); }
      `);

      const result = buildDraft(tmpDir);
      const technical = result.proposals.find(proposal => proposal.path === "vp/technical/api-protocol.yml");
      assert.ok(technical);
      assert.ok(technical.data.assert.some(item => item.rest_api_present));
      assert.ok(technical.data.assert.some(item => item.graphql_surface_absent));
    });
  });

  it("captures declared app frameworks in the repo-driven technical stack", () => {
    return withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        packageManager: "pnpm@9.0.0",
        dependencies: {
          next: "^15.0.0",
          react: "^19.0.0",
          graphql: "^16.0.0",
        },
      }));

      const result = buildDraft(tmpDir);
      const technical = result.proposals.find(proposal => proposal.path === "vp/technical/framework-stack.yml");
      assert.ok(technical);
      assert.ok(technical.data.assert.some(item => item.dependency_present?.name === "next"));
      assert.ok(technical.data.assert.some(item => item.dependency_present?.name === "react"));
      assert.ok(technical.data.assert.some(item => item.dependency_present?.name === "graphql"));
    });
  });

  it("proposes testing tooling constraints from detected SaaS configs", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        scripts: { "test:e2e": "browserstack-node-sdk playwright test" },
        devDependencies: {
          "@playwright/test": "^1.0.0",
          "browserstack-node-sdk": "^1.0.0",
          "@percy/cli": "^1.0.0",
        },
      }));
      fs.writeFileSync(path.join(tmpDir, ".browserstack.yml"), "userName: demo\n");
      fs.writeFileSync(path.join(tmpDir, ".percy.yml"), "version: 2\n");

      const result = buildDraft(tmpDir);
      const technical = result.proposals.find(proposal => proposal.path === "vp/technical/testing-tooling.yml");
      assert.ok(technical);
      assert.ok(technical.data.assert.some(item => item.path_exists?.path === ".browserstack.yml"));
      assert.ok(technical.data.assert.some(item => item.path_exists?.path === ".percy.yml"));
      assert.ok(technical.data.assert.some(item => item.script_present?.name === "test:e2e"));
    });
  });

  it("proposes backend-native technical architecture checks when the request names tsarch", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src", "domain"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "src", "ui"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "domain", "model.ts"), "export const domain = true;\n");
      fs.writeFileSync(path.join(tmpDir, "src", "ui", "screen.ts"), "export const screen = true;\n");
      fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "esnext" } }));

      const result = buildDraft(tmpDir, "TypeScript app with tsarch and architecture boundaries");
      const technical = result.proposals.find(proposal => proposal.type === "technical" && proposal.path === "vp/technical/architecture-boundaries.yml");
      assert.ok(technical);
      assert.equal(technical.data.runner.framework, "tsarch");
      assert.ok(technical.data.assert.some(item => item.no_circular_dependencies));
      assert.equal(technical.data.assert.some(item => item.command_succeeds), false);
    });
  });

  it("asks for a brownfield delivery clarification when the platform choice is ambiguous", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "tmp", private: true }));

      const result = buildDraft(tmpDir, "add cross-browser testing on real devices to the existing app");
      const clarification = result.clarifications.find(item => item.id === "technical-delivery-choice");
      assert.ok(clarification);
      assert.ok(result.proposals.some(proposal => proposal.type === "technical" && proposal.clarification_ids?.includes("technical-delivery-choice")));
    });
  });

  it("does not require a brownfield clarification when the human explicitly leaves the choice to AI", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "tmp", private: true }));

      const result = buildDraft(tmpDir, "add cross-browser testing on real devices to the existing app, you choose the platform");
      assert.equal(result.clarifications.some(item => item.id === "technical-delivery-choice"), false);
    });
  });

  it("proposes TUI behavior starters when the request is CLI-centric", () => {
    return withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "cli.js"), "process.stdin.resume();\n");

      const result = buildDraft(tmpDir, "terminal todo app with a CLI");
      const behavior = result.proposals.find(proposal => proposal.type === "behavior");
      assert.ok(behavior);
      assert.equal(behavior.data.app.kind, "tui");
      assert.equal(behavior.data.when[0].stdin.text, "--help\n");
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
      assert.equal(options.timeoutMs, 600000);
    });
  });

  it("prefers draft timeoutMs and falls back to impl timeoutMs", async () => {
    await withTmpDir(async tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        draft: {
          provider: "local",
          timeoutMs: 12345,
        },
        impl: {
          timeoutMs: 54321,
        },
      }));

      const direct = resolveDraftOptions(tmpDir, {}, {
        commandExists: () => false,
      });
      assert.equal(direct.timeoutMs, 12345);

      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        draft: {
          provider: "local",
        },
        impl: {
          timeoutMs: 54321,
        },
      }));
      const fallback = resolveDraftOptions(tmpDir, {}, {
        commandExists: () => false,
      });
      assert.equal(fallback.timeoutMs, 54321);
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

  it("keeps warning-prone brownfield verification candidates out of auto-write while still surfacing them", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), `
        app.get("/api/users", handler);
        const link = '<a href="/home">Home</a>';
        const sql = "SELECT * FROM users";
        const token = req.headers.authorization;
      `);

      const { result } = await draft({
        cwd: tmpDir,
        write: true,
        json: false,
      });

      const database = result.proposals.find(proposal => proposal.path === "vp/db/seed-users.yml");
      assert.equal(database.validation.auto_write, false);
      assert.ok(!result.written.includes("vp/db/seed-users.yml"));
      assert.ok(result.proposal_validation.needs_review >= 1);
    });
  });

  it("keeps brownfield technical starters out of auto-write until clarifications are resolved", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "tmp", private: true }));

      const { result } = await draft({
        cwd: tmpDir,
        input: "add cross-browser testing on real devices to the existing app",
        write: true,
        json: false,
      });

      const technical = result.proposals.find(proposal => proposal.type === "technical");
      assert.ok(technical);
      assert.equal(technical.validation.auto_write, false);
      assert.ok(result.clarifications.some(item => item.id === "technical-delivery-choice"));
      assert.equal(result.written.some(file => file.startsWith("vp/technical/")), false);
    });
  });

  it("persists draft review decisions and writes only accepted proposals when review exists", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      await draft({
        cwd: tmpDir,
        input: "todo app with REST API and sqlite",
        json: false,
      });

      const sessionFile = path.join(tmpDir, ".shipflow", "draft-session.json");
      assert.ok(fs.existsSync(sessionFile));
      const initialSession = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      assert.ok(initialSession.vp_snapshot);
      assert.ok(Array.isArray(initialSession.vp_snapshot.files));
      assert.equal(typeof initialSession.vp_snapshot.vp_sha256, "string");

      const acceptedPath = "vp/technical/sqlite-runtime.yml";
      const rejectedPath = "vp/technical/api-protocol.yml";
      const reviewed = await draft({
        cwd: tmpDir,
        input: "todo app with REST API and sqlite",
        json: false,
        accept: [acceptedPath],
        reject: [rejectedPath],
      });

      assert.equal(reviewed.result.review_updates.accepted, 1);
      assert.equal(reviewed.result.review_updates.rejected, 1);
      assert.equal(reviewed.result.session.ready_for_implement, false);
      assert.ok(reviewed.result.session.blocking_reasons.length > 0);

      const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      const accepted = session.proposals.find(proposal => proposal.path === acceptedPath);
      const rejected = session.proposals.find(proposal => proposal.path === rejectedPath);
      assert.equal(accepted.review.decision, "accept");
      assert.equal(rejected.review.decision, "reject");

      const followUp = await draft({
        cwd: tmpDir,
        input: "todo app with REST API and sqlite",
        json: false,
      });
      const persistedAccepted = followUp.result.proposals.find(proposal => proposal.path === acceptedPath);
      const persistedRejected = followUp.result.proposals.find(proposal => proposal.path === rejectedPath);
      assert.equal(persistedAccepted.review.decision, "accept");
      assert.equal(persistedRejected.review.decision, "reject");

      const written = await draft({
        cwd: tmpDir,
        input: "todo app with REST API and sqlite",
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
        input: "todo app with REST API and sqlite",
        json: false,
      });

      const acceptedPath = "vp/technical/sqlite-runtime.yml";
      const followUp = await draft({
        cwd: tmpDir,
        json: false,
        accept: [acceptedPath],
      });

      assert.equal(followUp.result.request.raw, "todo app with REST API and sqlite");
      const accepted = followUp.result.proposals.find(proposal => proposal.path === acceptedPath);
      assert.equal(accepted.review.decision, "accept");
      assert.equal(followUp.result.conversation_mode, "greenfield-shape-first");
      assert.ok(Array.isArray(followUp.result.opening_questions));
      assert.ok(followUp.result.workflow);
      assert.equal(followUp.result.workflow.phase, "draft");
      assert.equal(followUp.result.type_discussion.length, 7);
      assert.ok(followUp.result.type_discussion.some(item => item.type === "security"));
    });
  });

  it("does not carry review decisions into a different explicit request", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      await draft({
        cwd: tmpDir,
        input: "todo app with REST API and sqlite",
        json: false,
        accept: ["vp/technical/sqlite-runtime.yml"],
      });

      const fresh = await draft({
        cwd: tmpDir,
        input: "todo app with GraphQL and sqlite",
        json: false,
      });

      const technical = fresh.result.proposals.find(proposal => proposal.path === "vp/technical/sqlite-runtime.yml");
      assert.ok(technical);
      assert.equal(technical.review.decision, "pending");
    });
  });

  it("uses the saved draft session for review-only commands without calling the AI provider", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      await draft({
        cwd: tmpDir,
        input: "todo app with REST API and sqlite",
        json: false,
      });

      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        draft: {
          provider: "command",
        },
      }));

      let called = false;
      const result = await draft({
        cwd: tmpDir,
        json: false,
        accept: ["vp/technical/sqlite-runtime.yml"],
        generateText: async () => {
          called = true;
          return JSON.stringify({ summary: "should not run", proposals: [] });
        },
      });

      assert.equal(result.exitCode, 0);
      assert.equal(called, false);
      const technical = result.result.proposals.find(proposal => proposal.path === "vp/technical/sqlite-runtime.yml");
      assert.equal(technical.review.decision, "accept");
    });
  });

  it("fails review-only commands when no session or request is available", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = await draft({
        cwd: tmpDir,
        json: false,
        accept: ["vp/technical/sqlite-runtime.yml"],
      });

      assert.equal(result.exitCode, 2);
      assert.match(result.result.error, /existing draft session or a new request/i);
      assert.ok(!fs.existsSync(path.join(tmpDir, ".shipflow", "draft-session.json")));
    });
  });

  it("fails when the same proposal path appears in conflicting review flags", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      const result = await draft({
        cwd: tmpDir,
        input: "todo app with REST API and sqlite",
        json: false,
        accept: ["vp/technical/sqlite-runtime.yml"],
        reject: ["vp/technical/sqlite-runtime.yml"],
      });

      assert.equal(result.exitCode, 2);
      assert.match(result.result.error, /appears in both --accept and --reject/i);
    });
  });

  it("clears the saved draft session explicitly", async () => {
    await withTmpDir(async tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "export const app = true;\n");

      await draft({
        cwd: tmpDir,
        input: "todo app with REST API and sqlite",
        json: false,
      });

      const sessionFile = path.join(tmpDir, ".shipflow", "draft-session.json");
      assert.ok(fs.existsSync(sessionFile));

      const cleared = await draft({
        cwd: tmpDir,
        json: false,
        clearSession: true,
      });

      assert.equal(cleared.exitCode, 0);
      assert.equal(cleared.result.cleared, true);
      assert.ok(!fs.existsSync(sessionFile));
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
        input: "users api contract",
        json: false,
        write: true,
        accept: ["vp/api/existing-users.yml"],
        generateText,
      });
      assert.ok(!protectedWrite.result.written.includes("vp/api/existing-users.yml"));
      assert.match(fs.readFileSync(path.join(tmpDir, "vp", "api", "existing-users.yml"), "utf-8"), /Old API contract/);

      const updatedWrite = await draft({
        cwd: tmpDir,
        input: "users api contract",
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
