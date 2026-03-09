import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { buildMap } from "./map.js";
import { runLint } from "./lint.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { readConfig } from "./config.js";
import { collectStatus } from "./status.js";
import { computeVerificationPackSnapshot } from "./util/vp-snapshot.js";
import { DEFAULT_PROVIDER_TIMEOUT_MS, generateWithProvider, normalizeProviderText, resolveProviderModel, resolveProviderName } from "./providers/index.js";

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "draft";
}

function routeSlug(route) {
  return route === "/" ? "home" : slugify(route);
}

function routeUiProposalPath(route) {
  return `vp/ui/route-${routeSlug(route)}.yml`;
}

function routeUiProposalId(route) {
  return `ui-route-${routeSlug(route)}`;
}

function routeBehaviorProposalPath(route) {
  return `vp/behavior/main-flow-${routeSlug(route)}.yml`;
}

function routeBehaviorProposalId(route) {
  return `behavior-main-flow-${routeSlug(route)}`;
}

function apiProposalPath(method, apiPath) {
  return `vp/api/${slugify(`${String(method || "").toLowerCase()}-${apiPath}`)}.yml`;
}

function apiProposalId(method, apiPath) {
  return `api-${slugify(`${String(method || "").toLowerCase()}-${apiPath}`)}`;
}

function performanceProposalPath(proposalKey, endpoint) {
  return `vp/nfr/${slugify(`${proposalKey}-${endpoint}`)}.yml`;
}

function performanceProposalId(proposalKey, endpoint) {
  return `performance-${slugify(`${proposalKey}-${endpoint}`)}`;
}

function securityProtectionProposalPath(protectedPath) {
  return `vp/security/${slugify(`${protectedPath}-auth`)}.yml`;
}

function securityProtectionProposalId(protectedPath) {
  return `security-${slugify(`${protectedPath}-auth`)}`;
}

function dbProposalPathForRequest(requestRaw, engine) {
  if (requestNeedsDetailedTodoPack(requestRaw)) return "vp/db/todos-state.yml";
  const entity = inferRequestedEntity(requestRaw);
  if (entity.table && entity.table !== "records") return `vp/db/${slugify(`${entity.table}-state`)}.yml`;
  return `vp/db/${slugify(`${engine}-state`)}.yml`;
}

function dedupeProposalsByPath(proposals) {
  const merged = new Map();
  for (const proposal of proposals) {
    if (merged.has(proposal.path)) merged.delete(proposal.path);
    merged.set(proposal.path, proposal);
  }
  return [...merged.values()];
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function draftSessionPath(cwd) {
  return path.join(cwd, ".shipflow", "draft-session.json");
}

function loadDraftSession(cwd) {
  const file = draftSessionPath(cwd);
  if (!fs.existsSync(file)) {
    return { exists: false, ok: true, path: file, data: null };
  }
  try {
    return { exists: true, ok: true, path: file, data: JSON.parse(fs.readFileSync(file, "utf-8")) };
  } catch (error) {
    return { exists: true, ok: false, path: file, data: null, error };
  }
}

function collectDraftGaps(result) {
  return [...new Set([...(result.map?.coverage?.gaps || []), ...(result.request?.gaps || [])])];
}

function clearDraftSession(cwd) {
  const file = draftSessionPath(cwd);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

function listWorkflowFiles(cwd) {
  const dir = path.join(cwd, ".github", "workflows");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(f => `.github/workflows/${f}`);
}

function firstExistingPath(cwd, candidates) {
  return candidates.find(rel => fs.existsSync(path.join(cwd, rel))) || null;
}

function collectSignals(cwd) {
  const pkg = readJsonIfExists(path.join(cwd, "package.json"));
  const deps = {
    ...pkg?.dependencies,
    ...pkg?.devDependencies,
    ...pkg?.peerDependencies,
    ...pkg?.optionalDependencies,
  };
  const depNames = Object.keys(deps || {});
  const scripts = pkg?.scripts || {};
  return {
    packageJson: pkg,
    depNames,
    scripts,
    packageManager: typeof pkg?.packageManager === "string" ? pkg.packageManager : null,
    workflows: listWorkflowFiles(cwd),
    hasPlaywright: depNames.includes("@playwright/test"),
    hasTsArch: depNames.includes("tsarch"),
    hasDepCruiser: depNames.includes("dependency-cruiser"),
    hasMadge: depNames.includes("madge"),
    hasBoundaries: depNames.includes("eslint-plugin-boundaries"),
    hasBrowserstack: depNames.some(name => name.includes("browserstack")),
    hasSauce: depNames.some(name => name.includes("sauce")),
    hasPercy: depNames.some(name => name.includes("percy")),
    hasDetox: depNames.includes("detox"),
    hasMaestro: depNames.some(name => name.includes("maestro")),
    nextConfig: firstExistingPath(cwd, ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs"]),
    playwrightConfig: firstExistingPath(cwd, ["playwright.config.ts", "playwright.config.mjs", "playwright.config.js", "playwright.config.cjs"]),
    browserstackConfig: firstExistingPath(cwd, [
      "browserstack.yml",
      "browserstack.yaml",
      "browserstack.json",
      ".browserstack.yml",
      ".browserstack.yaml",
      ".browserstack.json",
    ]),
    sauceConfig: firstExistingPath(cwd, [
      ".sauce/config.yml",
      ".sauce/config.yaml",
      ".sauce.yml",
      ".sauce.yaml",
      "sauce.yml",
      "sauce.yaml",
    ]),
    percyConfig: firstExistingPath(cwd, [
      ".percy.yml",
      ".percy.yaml",
      "percy.yml",
      "percy.yaml",
      ".percyrc",
    ]),
  };
}

const TECHNICAL_STACK_DEPENDENCIES = [
  "next",
  "react",
  "react-dom",
  "react-native",
  "vue",
  "@angular/core",
  "svelte",
  "express",
  "fastify",
  "@nestjs/core",
  "graphql",
  "@apollo/server",
  "@apollo/client",
  "urql",
  "relay-runtime",
  "@prisma/client",
  "prisma",
  "drizzle-orm",
  "mongoose",
  "redis",
  "ioredis",
];

function dedupeAssertions(assertions) {
  const seen = new Set();
  const out = [];
  for (const assertion of assertions) {
    const key = JSON.stringify(assertion);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(assertion);
  }
  return out;
}

function detectedStackAssertions(signals) {
  return TECHNICAL_STACK_DEPENDENCIES
    .filter(name => signals.depNames.includes(name))
    .map(name => ({ dependency_present: { name, section: "all" } }));
}

function extractRequestedPaths(raw) {
  const matches = String(raw || "").match(/(?<![.a-z0-9_-])\/[a-z0-9/_-]*/gi) || [];
  return [...new Set(matches.map(item => item.trim()))];
}

function extractExplicitUiRoute(raw) {
  return extractRequestedPaths(raw).find(item => item !== "/" && !item.startsWith("/api/")) || null;
}

function inferRequestedUiRoute(raw) {
  const explicit = extractExplicitUiRoute(raw);
  if (explicit) return explicit;
  const text = String(raw || "").toLowerCase();
  if (/\b(login|sign in|signin)\b/.test(text)) return "/login";
  if (/\b(sign up|signup|register)\b/.test(text)) return "/signup";
  if (/\bdashboard\b/.test(text)) return "/dashboard";
  if (/\badmin\b/.test(text)) return "/admin";
  if (/\bsettings\b/.test(text)) return "/settings";
  if (/\bprofile\b/.test(text)) return "/profile";
  if (/\bcart\b/.test(text)) return "/cart";
  if (/\bcheckout\b/.test(text)) return "/checkout";
  return "/";
}

function inferRequestedApiRequests(raw) {
  const proposals = [];
  const text = String(raw || "").toLowerCase();
  const seen = new Set();

  function push(method, apiPath, confidence, reason) {
    const key = `${method} ${apiPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    proposals.push({ method, path: apiPath, confidence, reason });
  }

  for (const explicit of extractRequestedPaths(raw).filter(item => item.startsWith("/api/"))) {
    push("GET", explicit, "high", `The request explicitly mentions API path ${explicit}.`);
  }

  if (/\badmin\b/.test(text)) {
    push("GET", "/api/admin", "medium", "The request mentions an admin API surface.");
  }
  if (/\b(login|sign in|signin)\b/.test(text)) {
    push("POST", "/api/login", "medium", "The request mentions an authentication API surface.");
  }
  if (/\b(sign up|signup|register)\b/.test(text)) {
    push("POST", "/api/signup", "medium", "The request mentions a registration API surface.");
  }
  if (/\b(todo|task)\b/.test(text)) {
    push("GET", "/api/todos", "medium", "The request describes a todo-style read API.");
    push("POST", "/api/todos", "medium", "The request describes a todo-style write API.");
  }
  if (/\b(user|account|profile)\b/.test(text)) {
    push(/\bprofile\b/.test(text) ? "GET" : "GET", /\bprofile\b/.test(text) ? "/api/profile" : "/api/users", "medium", "The request describes a user/account API domain.");
  }

  if (proposals.length === 0) {
    push("GET", "/api/health", "low", "The request needs API coverage, but only a generic health-style starter can be inferred.");
  }

  return proposals.slice(0, 3);
}

function inferRequestedApiRequest(raw) {
  return inferRequestedApiRequests(raw)[0];
}

function inferRequestedDbEngine(raw) {
  const text = String(raw || "").toLowerCase();
  if (/\bsqlite\b/.test(text)) return "sqlite";
  if (/\bpostgres|postgresql\b/.test(text)) return "postgresql";
  if (/\bmysql\b/.test(text)) return "mysql";
  return null;
}

function inferProtectedApiPath(raw) {
  const explicitProtected = extractRequestedPaths(raw)
    .filter(item => item.startsWith("/api/"))
    .find(item => !/\/(login|signup|register)(\/)?$/i.test(item));
  if (explicitProtected) return explicitProtected;
  const text = String(raw || "").toLowerCase();
  if (/\badmin\b/.test(text)) return "/api/admin";
  if (/\b(profile|account)\b/.test(text)) return "/api/profile";
  if (/\b(user|session|token|login|signin|auth)\b/.test(text)) return "/api/me";
  return "/api/admin";
}

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

function inferRequestedEntity(raw) {
  const text = String(raw || "").toLowerCase();
  if (/\b(todo|task)\b/.test(text)) {
    return {
      table: "todos",
      labelColumn: "title",
      initialValue: "Draft task",
      nextValue: "Follow-up task",
    };
  }
  if (/\b(user|account|profile)\b/.test(text)) {
    return {
      table: "users",
      labelColumn: "email",
      initialValue: "user@example.com",
      nextValue: "second-user@example.com",
    };
  }
  if (/\b(order|cart|checkout)\b/.test(text)) {
    return {
      table: "orders",
      labelColumn: "reference",
      initialValue: "order-001",
      nextValue: "order-002",
    };
  }
  return {
    table: "records",
    labelColumn: "name",
    initialValue: "Draft record",
    nextValue: "Follow-up record",
  };
}

function requestMentionsTodoDomain(raw) {
  return /\b(todo|todos|task|tasks)\b/i.test(String(raw || ""));
}

function requestMentionsAddTodo(raw) {
  return /\b(add|create|new)\b/i.test(String(raw || "")) && requestMentionsTodoDomain(raw);
}

function requestMentionsCompleteTodo(raw) {
  return /\b(complete|completed|mark[^.\n]*complete|toggle|done)\b/i.test(String(raw || "")) && requestMentionsTodoDomain(raw);
}

function requestMentionsFilterTodo(raw) {
  return /\b(filter|active|completed|status)\b/i.test(String(raw || "")) && requestMentionsTodoDomain(raw);
}

function requestNeedsDetailedTodoPack(raw) {
  const text = String(raw || "");
  return requestMentionsTodoDomain(text)
    && (
      requestMentionsAddTodo(text)
      || requestMentionsCompleteTodo(text)
      || requestMentionsFilterTodo(text)
      || extractRequestedPaths(text).includes("/api/todos")
    );
}

function buildTodoUiProposals() {
  return [
    fileProposal(
      "ui",
      "vp/ui/add-todo.yml",
      {
        id: "add-todo",
        title: "User can add a new todo item",
        severity: "blocker",
        app: { kind: "web", base_url: "http://localhost:3000" },
        flow: [
          { open: "/" },
          { fill: { testid: "new-todo-input", value: "Buy groceries" } },
          { click: { name: "Add" } },
          { wait_for: { ms: 300 } },
        ],
        assert: [
          { text_equals: { testid: "todo-item-last", equals: "Buy groceries" } },
          { count: { testid: "todo-item", equals: 1 } },
        ],
      },
      "high",
      "The request explicitly mentions adding todos, so ShipFlow can draft a concrete add-todo browser flow.",
    ),
    fileProposal(
      "ui",
      "vp/ui/complete-todo.yml",
      {
        id: "complete-todo",
        title: "User can mark a todo as complete",
        severity: "blocker",
        app: { kind: "web", base_url: "http://localhost:3000" },
        flow: [
          { open: "/" },
          { fill: { testid: "new-todo-input", value: "Write tests" } },
          { click: { name: "Add" } },
          { wait_for: { ms: 200 } },
          { click: { testid: "todo-toggle-0" } },
          { wait_for: { ms: 200 } },
        ],
        assert: [
          { visible: { testid: "todo-completed-0" } },
          { text_matches: { testid: "completed-count", regex: "1 completed" } },
        ],
      },
      "high",
      "The request explicitly mentions completing todos, so ShipFlow can draft a concrete completion flow.",
    ),
    fileProposal(
      "ui",
      "vp/ui/filter-todos.yml",
      {
        id: "filter-todos",
        title: "User can filter todos by status",
        severity: "blocker",
        app: { kind: "web", base_url: "http://localhost:3000" },
        flow: [
          { open: "/" },
          { fill: { testid: "new-todo-input", value: "Task one" } },
          { click: { name: "Add" } },
          { fill: { testid: "new-todo-input", value: "Task two" } },
          { click: { name: "Add" } },
          { wait_for: { ms: 200 } },
          { click: { testid: "todo-toggle-0" } },
          { wait_for: { ms: 200 } },
          { select: { label: "Filter", value: "active" } },
          { wait_for: { ms: 200 } },
        ],
        assert: [
          { count: { testid: "todo-item", equals: 1 } },
          { text_equals: { testid: "todo-item-0", equals: "Task two" } },
          { hidden: { testid: "no-todos-message" } },
          { url_matches: { regex: "filter=active" } },
        ],
      },
      "high",
      "The request explicitly mentions filtering todos, so ShipFlow can draft a concrete filtered list flow.",
    ),
  ];
}

function buildTodoBehaviorProposal() {
  return fileProposal(
    "behavior",
    "vp/behavior/get-api-todos-flow.yml",
    {
      id: "behavior-get-api-todos",
      feature: "API behavior",
      scenario: "POST then GET /api/todos exposes the created todo",
      severity: "blocker",
      app: { kind: "api", base_url: "http://localhost:3000" },
      given: [],
      when: [
        {
          request: {
            method: "POST",
            path: "/api/todos",
            body_json: {
              title: "Persisted behavior todo",
              completed: false,
            },
          },
        },
        {
          request: {
            method: "GET",
            path: "/api/todos",
          },
        },
      ],
      then: [
        { status: 200 },
        { header_matches: { name: "content-type", matches: "json" } },
        { json_type: { path: "$", type: "array" } },
        { json_array_includes: { path: "$", equals: { title: "Persisted behavior todo", completed: false } } },
        {
          json_schema: {
            path: "$",
            schema: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "title", "completed"],
                properties: {
                  id: { type: "number" },
                  title: { type: "string" },
                  completed: { type: "boolean" },
                },
              },
            },
          },
        },
      ],
    },
    "high",
    "The request describes todo creation plus later visibility, so ShipFlow can draft a concrete POST-then-GET API behavior flow.",
  );
}

function inferApiExpectedStatus(method, apiPath) {
  if (method === "DELETE") return 204;
  if (method === "POST" && /\/(signup|register)(\/)?$/i.test(apiPath)) return 201;
  if (method === "POST" && /\/(todos|tasks)(\/)?$/i.test(apiPath)) return 201;
  return 200;
}

function inferApiRequestBody(method, apiPath, raw = "") {
  if (!["POST", "PUT", "PATCH"].includes(method)) return null;
  const text = `${apiPath} ${raw}`.toLowerCase();
  if (/\b(login|sign in|signin)\b/.test(text) || /\/(login|signin)(\/)?$/i.test(apiPath)) {
    return { email: "user@example.com", password: "secret123" };
  }
  if (/\b(sign up|signup|register)\b/.test(text) || /\/(signup|register)(\/)?$/i.test(apiPath)) {
    return { email: "new-user@example.com", password: "secret123" };
  }
  if (/\b(todo|task)\b/.test(text) || /\/(todos|tasks)(\/)?$/i.test(apiPath)) {
    return { title: "Draft task", completed: false };
  }
  if (/\b(user|account|profile)\b/.test(text) || /\/(users|accounts|profiles)(\/)?$/i.test(apiPath)) {
    return { name: "Draft User" };
  }
  return { name: "Example" };
}

function inferApiResponseShape(method, apiPath) {
  if (method === "DELETE") return null;
  if (method === "GET" && /\/(todos|tasks|users|items|orders)(\/)?$/i.test(apiPath)) return "array";
  return "object";
}

function buildApiStarterContract(method, apiPath, raw = "") {
  const request = { method, path: apiPath };
  const expectedStatus = inferApiExpectedStatus(method, apiPath);
  const bodyJson = inferApiRequestBody(method, apiPath, raw);
  if (bodyJson) request.body_json = bodyJson;

  const assert = [{ status: expectedStatus }];
  if (expectedStatus !== 204) {
    assert.push({ header_matches: { name: "content-type", matches: "json" } });
  }

  const responseShape = inferApiResponseShape(method, apiPath);
  if (responseShape) {
    assert.push({ json_type: { path: "$", type: responseShape } });
    if (/\/(todos|tasks)(\/)?$/i.test(apiPath)) {
      if (responseShape === "array") {
        assert.push({
          json_schema: {
            path: "$",
            schema: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "title", "completed"],
                properties: {
                  id: { type: "number" },
                  title: { type: "string" },
                  completed: { type: "boolean" },
                },
              },
            },
          },
        });
      } else {
        assert.push({ json_has: { path: "$.id" } });
        assert.push({ json_equals: { path: "$.title", equals: bodyJson?.title || "Draft task" } });
        assert.push({ json_equals: { path: "$.completed", equals: bodyJson?.completed || false } });
        assert.push({
          json_schema: {
            path: "$",
            schema: {
              type: "object",
              required: ["id", "title", "completed"],
              properties: {
                id: { type: "number" },
                title: { type: "string" },
                completed: { type: "boolean" },
              },
            },
          },
        });
      }
    } else {
      assert.push({ json_schema: { path: "$", schema: { type: responseShape } } });
    }
  } else {
    assert.push({ body_not_contains: "stack trace" });
  }

  return { request, assert };
}

function buildRequestedDbStarter(raw, engine) {
  const entity = inferRequestedEntity(raw);
  const labelColumn = entity.labelColumn;
  const table = entity.table;
  const connection = engine === "postgresql" ? "postgresql://localhost/test" : "./test.db";

  if (table === "todos" && engine === "sqlite") {
    return {
      id: "db-todos-sqlite-lifecycle",
      title: "SQLite todos data lifecycle stays observable",
      severity: "blocker",
      app: { kind: "db", engine, connection },
      before_query: "PRAGMA table_info(todos);",
      before_assert: [
        { row_count_gte: 3 },
        { column_contains: { column: "name", value: "id" } },
        { column_contains: { column: "name", value: "title" } },
        { column_contains: { column: "name", value: "completed" } },
      ],
      setup_sql: [
        "CREATE TABLE IF NOT EXISTS todos (",
        "  id INTEGER PRIMARY KEY,",
        "  title TEXT NOT NULL,",
        "  completed INTEGER NOT NULL DEFAULT 0",
        ");",
        "DELETE FROM todos;",
        "INSERT INTO todos (id, title, completed) VALUES (1, 'Draft task', 0);",
      ].join("\n"),
      action_sql: "INSERT INTO todos (id, title, completed) VALUES (2, 'Follow-up task', 1);",
      query: "SELECT id, title, completed FROM todos ORDER BY id;",
      assert: [
        { row_count: 2 },
        { cell_equals: { row: 0, column: "title", equals: "Draft task" } },
        { cell_equals: { row: 1, column: "completed", equals: "1" } },
      ],
      cleanup_sql: "DELETE FROM todos;",
    };
  }

  const createSql = engine === "postgresql"
    ? [
        `DROP TABLE IF EXISTS ${table};`,
        `CREATE TABLE ${table} (`,
        "  id INTEGER PRIMARY KEY,",
        `  ${labelColumn} TEXT NOT NULL`,
        ");",
      ]
    : [
        `CREATE TABLE IF NOT EXISTS ${table} (`,
        "  id INTEGER PRIMARY KEY,",
        `  ${labelColumn} TEXT NOT NULL`,
        ");",
      ];
  return {
    id: `db-requested-${table}-${engine}-lifecycle`,
    title: `${table} data lifecycle stays observable`,
    severity: "warn",
    app: { kind: "db", engine, connection },
    setup_sql: [
      ...createSql,
      `DELETE FROM ${table};`,
      `INSERT INTO ${table} (id, ${labelColumn}) VALUES (1, '${escapeSqlString(entity.initialValue)}');`,
    ].join("\n"),
    before_query: `SELECT COUNT(*) AS count FROM ${table};`,
    before_assert: [{ cell_equals: { row: 0, column: "count", equals: "1" } }],
    action_sql: `INSERT INTO ${table} (id, ${labelColumn}) VALUES (2, '${escapeSqlString(entity.nextValue)}');`,
    query: `SELECT COUNT(*) AS count FROM ${table};`,
    assert: [{ cell_equals: { row: 0, column: "count", equals: "2" } }],
    cleanup_sql: `DROP TABLE IF EXISTS ${table};`,
  };
}

function inferSecurityCategory(raw, protectedPath = "") {
  const text = `${raw} ${protectedPath}`.toLowerCase();
  if (/\b(admin|role|permission|authz|authorization)\b/.test(text)) return "authz";
  return "authn";
}

function buildPerformanceScenario(endpoint, method = "GET", raw = "") {
  const text = String(raw || "").toLowerCase();
  const expectedStatus = inferApiExpectedStatus(method, endpoint);
  const bodyJson = inferApiRequestBody(method, endpoint, raw);

  if (/\bspike\b/.test(text)) {
    return {
      endpoint,
      method,
      ...(bodyJson ? { body_json: bodyJson } : {}),
      profile: "spike",
      thresholds: {
        http_req_duration_p95: 900,
        http_req_failed: 0.05,
        checks_rate: 0.95,
      },
      stages: [
        { duration: "10s", target: 5 },
        { duration: "10s", target: 50 },
        { duration: "15s", target: 5 },
      ],
      expected_status: expectedStatus,
    };
  }

  if (/\b(load|throughput|scale|stress)\b/.test(text)) {
    return {
      endpoint,
      method,
      ...(bodyJson ? { body_json: bodyJson } : {}),
      profile: /\bstress\b/.test(text) ? "stress" : "load",
      thresholds: {
        http_req_duration_p95: /\bstress\b/.test(text) ? 1000 : 750,
        http_req_failed: 0.05,
        checks_rate: 0.95,
      },
      stages: [
        { duration: "10s", target: 5 },
        { duration: "20s", target: /\bstress\b/.test(text) ? 30 : 20 },
        { duration: "10s", target: 0 },
      ],
      expected_status: expectedStatus,
    };
  }

  return {
    endpoint,
    method,
    ...(bodyJson ? { body_json: bodyJson } : {}),
    profile: "smoke",
    thresholds: {
      http_req_duration_p95: 500,
      http_req_failed: 0.05,
      checks_rate: 0.99,
    },
    vus: 10,
    duration: "15s",
    ramp_up: "5s",
    expected_status: expectedStatus,
  };
}

function buildPerformanceScenarios(endpoint, method = "GET", raw = "") {
  const primary = buildPerformanceScenario(endpoint, method, raw);
  const scenarios = [
    { profileKey: "smoke", proposalKey: "baseline", scenario: { ...buildPerformanceScenario(endpoint, method, "") } },
  ];

  if (primary.profile && primary.profile !== "smoke") {
    scenarios.push({ profileKey: primary.profile, proposalKey: primary.profile, scenario: primary });
  } else {
    scenarios[0] = { profileKey: "smoke", proposalKey: "baseline", scenario: primary };
  }

  return scenarios;
}

function pickRequestedPerformanceTarget(raw) {
  const apiRequests = inferRequestedApiRequests(raw);
  const preferredApi = apiRequests.find(candidate => candidate.method === "GET" && !/\/(login|signup|register)(\/)?$/i.test(candidate.path))
    || apiRequests.find(candidate => candidate.method === "GET")
    || apiRequests[0];
  if (preferredApi) return { method: preferredApi.method, endpoint: preferredApi.path };

  const route = inferRequestedUiRoute(raw);
  return { method: "GET", endpoint: route || "/" };
}

function buildRequestTechnicalAssertions(raw) {
  const text = String(raw || "").toLowerCase();
  const frameworkAssertions = [];
  const deliveryAssertions = [];

  const dependencies = [
    { pattern: /\bnext(\.js)?\b/, name: "next" },
    { pattern: /\breact\b/, name: "react" },
    { pattern: /\breact native\b/, name: "react-native" },
    { pattern: /\bvue\b/, name: "vue" },
    { pattern: /\bangular\b/, name: "@angular/core" },
    { pattern: /\bsvelte\b/, name: "svelte" },
    { pattern: /\bexpress\b/, name: "express" },
    { pattern: /\bfastify\b/, name: "fastify" },
    { pattern: /\bnest(js)?\b/, name: "@nestjs/core" },
    { pattern: /\bgraphql\b/, name: "graphql" },
    { pattern: /\bapollo server\b/, name: "@apollo/server" },
    { pattern: /\bapollo client\b/, name: "@apollo/client" },
    { pattern: /\burql\b/, name: "urql" },
    { pattern: /\brelay\b/, name: "relay-runtime" },
    { pattern: /\btsarch\b/, name: "tsarch" },
    { pattern: /\bdependency-cruiser\b/, name: "dependency-cruiser" },
    { pattern: /\bmadge\b/, name: "madge" },
    { pattern: /\beslint-plugin-boundaries\b/, name: "eslint-plugin-boundaries" },
    { pattern: /\bbrowserstack\b/, name: "browserstack" },
    { pattern: /\bsauce\b/, name: "saucectl" },
    { pattern: /\bpercy\b/, name: "@percy/cli" },
    { pattern: /\bdetox\b/, name: "detox" },
    { pattern: /\bmaestro\b/, name: "maestro" },
  ];

  for (const dependency of dependencies) {
    if (dependency.pattern.test(text)) {
      frameworkAssertions.push({ dependency_present: { name: dependency.name, section: "all" } });
    }
  }

  if (/\bpnpm\b/.test(text)) frameworkAssertions.push({ json_matches: { path: "package.json", query: "$.packageManager", matches: "^pnpm@" } });
  if (/\byarn\b/.test(text)) frameworkAssertions.push({ json_matches: { path: "package.json", query: "$.packageManager", matches: "^yarn@" } });
  if (/\bbun\b/.test(text)) frameworkAssertions.push({ json_matches: { path: "package.json", query: "$.packageManager", matches: "^bun@" } });
  if (/\bnpm\b/.test(text) && !/\bpnpm\b|\byarn\b|\bbun\b/.test(text)) {
    frameworkAssertions.push({ json_matches: { path: "package.json", query: "$.packageManager", matches: "^npm@" } });
  }

  if (/\b(ci|github actions)\b/.test(text)) {
    deliveryAssertions.push({ path_exists: { path: ".github/workflows/ci.yml" } });
    deliveryAssertions.push({ github_action_uses: { workflow: ".github/workflows/ci.yml", action: "actions/checkout@v4" } });
  }
  if (/\bdocker\b/.test(text)) deliveryAssertions.push({ path_exists: { path: "Dockerfile" } });
  if (/\bterraform\b/.test(text)) deliveryAssertions.push({ path_exists: { path: "terraform" } });
  if (/\bkubernetes\b|\bk8s\b/.test(text)) deliveryAssertions.push({ path_exists: { path: "k8s" } });
  if (/\bhelm\b/.test(text)) deliveryAssertions.push({ path_exists: { path: "helm" } });
  if (/\bpulumi\b/.test(text)) deliveryAssertions.push({ path_exists: { path: "pulumi" } });

  return { frameworkAssertions, deliveryAssertions };
}

function requestMentionsDeliveryTestingStack(raw) {
  return /\b(ci|infra|infrastructure|deploy|deployment|browser testing|cross-browser|real devices|mobile devices|visual regression|testing saas|testing platform|cloud testing)\b/i.test(String(raw || ""));
}

function requestMentionsConcreteDeliveryChoice(raw) {
  return /\b(browserstack|sauce|sauce labs|percy|github actions|docker|terraform|kubernetes|k8s|pulumi|helm)\b/i.test(String(raw || ""));
}

function inferRequestedApiProtocol(raw) {
  const text = String(raw || "").toLowerCase();
  if (requestForbidsGraphql(text)) return "rest";
  if (requestForbidsRest(text)) return "graphql";
  if (/\b(graphql|apollo|urql|relay)\b/.test(text)) return "graphql";
  if (/\brest\b/.test(text)) return "rest";
  if (extractRequestedPaths(raw).some(item => item.startsWith("/api/"))) return "rest";
  return null;
}

function requestForbidsRest(raw) {
  return /\b(graphql[- ]only|graphql only|instead of rest|not rest|no rest|without rest)\b/i.test(String(raw || ""));
}

function requestForbidsGraphql(raw) {
  return /\b(rest[- ]only|rest only|instead of graphql|not graphql|no graphql|without graphql)\b/i.test(String(raw || ""));
}

function buildRequestedProtocolProposal(map, request) {
  const protocol = inferRequestedApiProtocol(request.raw);
  if (!protocol) return null;
  const files = "**/*";
  if (protocol === "graphql") {
    const assertions = [
      { graphql_surface_present: { files, endpoint: "/graphql" } },
    ];
    if (requestForbidsRest(request.raw)) {
      assertions.push({ rest_api_absent: { files, path_prefix: "/api/", allow_paths: ["/graphql", "/api/graphql"] } });
    }
    return fileProposal(
      "technical",
      "vp/technical/api-protocol.yml",
      {
        id: "technical-api-protocol",
        title: "Requested GraphQL protocol stays enforced",
        severity: "blocker",
        category: "framework",
        runner: { kind: "custom", framework: "custom" },
        app: { kind: "technical", root: "." },
        assert: assertions,
      },
      "medium",
      "The request names GraphQL as a protocol choice that should stay executable and enforceable.",
    );
  }
  const assertions = [
    { rest_api_present: { files, path_prefix: "/api/" } },
  ];
  if (requestForbidsGraphql(request.raw)) {
    assertions.push({ graphql_surface_absent: { files, endpoint: "/graphql" } });
  }
  return fileProposal(
    "technical",
    "vp/technical/api-protocol.yml",
    {
      id: "technical-api-protocol",
      title: "Requested REST protocol stays enforced",
      severity: "blocker",
      category: "framework",
      runner: { kind: "custom", framework: "custom" },
      app: { kind: "technical", root: "." },
      assert: assertions,
    },
    "medium",
    "The request names REST as a protocol choice that should stay executable and enforceable.",
  );
}

function buildRequestedSqliteRuntimeProposal(cwd, request) {
  if (inferRequestedDbEngine(request.raw) !== "sqlite") return null;
  if (/\b(better-sqlite3|sqlite3)\b/i.test(String(request.raw || ""))) return null;
  const signals = collectSignals(cwd);
  if (!signals.packageJson) return null;
  return fileProposal(
    "technical",
    "vp/technical/sqlite-runtime.yml",
    {
      id: "technical-sqlite-runtime",
      title: "Requested SQLite runtime stays portable",
      severity: "blocker",
      category: "framework",
      runner: { kind: "custom", framework: "custom" },
      app: { kind: "technical", root: "." },
      assert: [
        { path_exists: { path: "package.json" } },
        { dependency_absent: { name: "better-sqlite3", section: "all" } },
        { dependency_absent: { name: "sqlite3", section: "all" } },
      ],
    },
    "medium",
    "The request names SQLite on a Node project, so ShipFlow can keep the runtime portable by forbidding native SQLite addons.",
  );
}

function graphqlAllowPaths(endpoints = []) {
  const allowed = new Set();
  for (const endpoint of endpoints) {
    const normalized = String(endpoint || "").startsWith("/") ? String(endpoint) : `/${endpoint}`;
    allowed.add(normalized);
    if (normalized.startsWith("/api/")) allowed.add(normalized.replace(/^\/api/, "") || "/");
    else allowed.add(`/api${normalized}`.replace(/\/+/g, "/"));
  }
  return [...allowed].filter(Boolean);
}

function buildDetectedProtocolProposal(map) {
  const files = "**/*";
  const protocols = map.detected?.protocols || {};
  const graphql = protocols.graphql || { detected: false, endpoints: [] };
  const rest = protocols.rest || { detected: false, endpoints: [], path_prefix: "/api/" };

  if (graphql.detected && !rest.detected) {
    const endpoint = graphql.endpoints[0] || "/graphql";
    return fileProposal(
      "technical",
      "vp/technical/api-protocol.yml",
      {
        id: "technical-api-protocol",
        title: "Detected GraphQL protocol stays enforced",
        severity: "blocker",
        category: "framework",
        runner: { kind: "custom", framework: "custom" },
        app: { kind: "technical", root: "." },
        assert: [
          { graphql_surface_present: { files, endpoint } },
          { rest_api_absent: { files, path_prefix: "/api/", allow_paths: graphqlAllowPaths(graphql.endpoints) } },
        ],
      },
      "high",
      `The repository exposes a concrete GraphQL surface at ${endpoint} and no competing REST surface was detected.`,
    );
  }

  if (rest.detected && !graphql.detected) {
    return fileProposal(
      "technical",
      "vp/technical/api-protocol.yml",
      {
        id: "technical-api-protocol",
        title: "Detected REST protocol stays enforced",
        severity: "blocker",
        category: "framework",
        runner: { kind: "custom", framework: "custom" },
        app: { kind: "technical", root: "." },
        assert: [
          { rest_api_present: { files, path_prefix: rest.path_prefix || "/api/" } },
          { graphql_surface_absent: { files, endpoint: "/graphql" } },
        ],
      },
      "high",
      `The repository exposes concrete REST routes under ${rest.path_prefix || "/api/"} and no GraphQL surface was detected.`,
    );
  }

  return null;
}

function pathExists(cwd, rel) {
  return fs.existsSync(path.join(cwd, rel));
}

function chooseTechnicalArchitectureFramework(signals, preferred = null) {
  if (preferred) return preferred;
  if (signals.hasDepCruiser) return "dependency-cruiser";
  if (signals.hasTsArch) return "tsarch";
  if (signals.hasBoundaries) return "eslint-plugin-boundaries";
  if (signals.hasMadge) return "madge";
  return null;
}

function technicalSourceRoot(map) {
  const root = map?.project?.source_roots?.find(item => item && item !== ".") || "src";
  return root.replace(/\/+$/, "");
}

function buildTechnicalCodeGlob(sourceRoot) {
  return `${sourceRoot}/**/*`;
}

function buildArchitectureLayers(cwd, sourceRoot) {
  const candidates = [
    { name: "ui", rel: ["ui", "presentation", "screens", "pages", "components"] },
    { name: "application", rel: ["application", "use-cases", "usecases", "services"] },
    { name: "domain", rel: ["domain", "core"] },
    { name: "shared", rel: ["shared", "common", "lib"] },
    { name: "infrastructure", rel: ["infra", "infrastructure", "data", "adapters"] },
  ];

  const layers = [];
  for (const candidate of candidates) {
    const found = candidate.rel.find(rel => pathExists(cwd, path.join(sourceRoot, rel)));
    if (!found) continue;
    layers.push({ name: candidate.name, dir: `${sourceRoot}/${found}` });
  }

  const existing = new Set(layers.map(layer => layer.name));
  const allowed = {
    ui: ["application", "shared"],
    application: ["domain", "shared"],
    domain: ["shared"],
    shared: [],
    infrastructure: ["application", "domain", "shared"],
  };

  return layers.map(layer => ({
    name: layer.name,
    files: `${layer.dir}/**/*`,
    may_import: (allowed[layer.name] || []).filter(name => existing.has(name)),
  }));
}

function buildArchitectureAssertions(cwd, map, framework) {
  const sourceRoot = technicalSourceRoot(map);
  const layers = buildArchitectureLayers(cwd, sourceRoot);
  const assertions = [];

  if (framework === "custom") {
    if (layers.length >= 2) {
      assertions.push({
        layer_dependencies: {
          layers,
          allow_external: true,
          allow_unmatched_relative: false,
          allow_same_layer: true,
        },
      });
    }
    const circular = { files: buildTechnicalCodeGlob(sourceRoot) };
    if (pathExists(cwd, "tsconfig.json")) circular.tsconfig = "tsconfig.json";
    assertions.push({ no_circular_dependencies: circular });
    if (layers.some(layer => layer.name === "domain") && layers.some(layer => layer.name === "ui")) {
      const domainLayer = layers.find(layer => layer.name === "domain");
      const uiLayer = layers.find(layer => layer.name === "ui");
      assertions.push({
        imports_forbidden: {
          files: domainLayer.files,
          patterns: [`${uiLayer.dir}/**`, "react"],
        },
      });
    }
    return assertions;
  }

  if (layers.length >= 2 && (framework === "dependency-cruiser" || framework === "eslint-plugin-boundaries")) {
    assertions.push({
      layer_dependencies: {
        layers,
        allow_external: true,
        allow_unmatched_relative: false,
        allow_same_layer: true,
      },
    });
  }

  if (framework === "madge") {
    const circular = { files: buildTechnicalCodeGlob(sourceRoot) };
    if (pathExists(cwd, "tsconfig.json")) circular.tsconfig = "tsconfig.json";
    assertions.push({ no_circular_dependencies: circular });
    return assertions;
  }

  if (framework === "tsarch") {
    const circular = { files: buildTechnicalCodeGlob(sourceRoot) };
    if (pathExists(cwd, "tsconfig.json")) circular.tsconfig = "tsconfig.json";
    assertions.push({ no_circular_dependencies: circular });
    if (layers.some(layer => layer.name === "domain") && layers.some(layer => layer.name === "ui")) {
      const domainLayer = layers.find(layer => layer.name === "domain");
      const uiLayer = layers.find(layer => layer.name === "ui");
      assertions.push({
        imports_forbidden: {
          files: domainLayer.files,
          patterns: [`${uiLayer.dir}/**`, "react"],
        },
      });
    }
    return assertions;
  }

  if (framework === "dependency-cruiser") {
    if (assertions.length === 0 && layers.some(layer => layer.name === "domain") && layers.some(layer => layer.name === "ui")) {
      const domainLayer = layers.find(layer => layer.name === "domain");
      const uiLayer = layers.find(layer => layer.name === "ui");
      assertions.push({
        imports_forbidden: {
          files: domainLayer.files,
          patterns: [`${uiLayer.dir}/**`],
        },
      });
    }
    return assertions;
  }

  if (framework === "eslint-plugin-boundaries") return assertions;

  return assertions;
}

function buildArchitectureProposal(cwd, map, framework, confidence, reason) {
  const assertions = buildArchitectureAssertions(cwd, map, framework);
  if (assertions.length === 0) return null;
  return fileProposal(
    "technical",
    "vp/technical/architecture-boundaries.yml",
      {
        id: "technical-architecture-boundaries",
        title: framework === "custom"
          ? "Architecture boundaries stay observable"
          : "Architecture boundaries stay enforced",
        severity: "blocker",
        category: "architecture",
        runner: framework === "custom"
          ? { kind: "custom", framework: "custom" }
          : { kind: "archtest", framework },
        app: { kind: "technical", root: "." },
        assert: assertions,
      },
      confidence,
    reason,
  );
}

function fileProposal(type, relPath, data, confidence, reason) {
  return { type, path: relPath, data, confidence, reason, source: "local" };
}

function uiProposals(map) {
  if (map.coverage.current.ui > 0) return [];
  return map.detected.ui_routes.slice(0, 3).map(route =>
    fileProposal(
      "ui",
      routeUiProposalPath(route),
      {
        id: routeUiProposalId(route),
        title: `Route ${route} is reachable`,
        severity: "warn",
        app: { kind: "web", base_url: "http://localhost:3000" },
        flow: [{ open: route }],
        assert: [{ url_matches: { regex: route === "/" ? "/" : route } }],
      },
      "medium",
      `Static analysis detected route ${route}.`,
    )
  );
}

function apiProposals(map) {
  if (map.coverage.current.api > 0) return [];
  const proposals = [];
  for (const endpoint of map.detected.api_endpoints.slice(0, 3)) {
    const match = endpoint.match(/^(GET|POST|PUT|PATCH|DELETE|FETCH)\s+(.+)$/);
    if (!match) continue;
    const method = match[1] === "FETCH" ? "GET" : match[1];
    const apiPath = match[2];
    const contract = buildApiStarterContract(method, apiPath);
    proposals.push(fileProposal(
      "api",
      `vp/api/${slugify(`${method.toLowerCase()}-${apiPath}`)}.yml`,
      {
        id: slugify(`api-${method.toLowerCase()}-${apiPath}`),
        title: `${method} ${apiPath} responds successfully`,
        severity: "warn",
        app: { kind: "api", base_url: "http://localhost:3000" },
        request: contract.request,
        assert: contract.assert,
      },
      apiPath.includes("/api/") ? "medium" : "low",
      `Static analysis detected endpoint ${method} ${apiPath}.`,
    ));
  }
  return proposals;
}

function behaviorProposalForWeb(route, confidence, reason) {
  return fileProposal(
    "behavior",
    routeBehaviorProposalPath(route),
    {
      id: routeBehaviorProposalId(route),
      feature: "Main user flow",
      scenario: `User can reach ${route}`,
      severity: "warn",
      app: { kind: "web", base_url: "http://localhost:3000" },
      given: [{ open: route }],
      when: [],
      then: [{ url_matches: { regex: route === "/" ? "/" : route } }],
    },
    confidence,
    reason,
  );
}

function behaviorProposalForApi(method, apiPath, confidence, reason) {
  const contract = buildApiStarterContract(method, apiPath);
  return fileProposal(
    "behavior",
    `vp/behavior/${slugify(`${method.toLowerCase()}-${apiPath}-flow`)}.yml`,
    {
      id: `behavior-${slugify(`${method.toLowerCase()}-${apiPath}`)}`,
      feature: "API behavior",
      scenario: `${method} ${apiPath} satisfies the primary contract`,
      severity: "warn",
      app: { kind: "api", base_url: "http://localhost:3000" },
      given: [],
      when: [{ request: contract.request }],
      then: contract.assert,
    },
    confidence,
    reason,
  );
}

function behaviorProposalForTui(command, confidence, reason) {
  return fileProposal(
    "behavior",
    "vp/behavior/main-cli-flow.yml",
    {
      id: "behavior-main-cli-flow",
      feature: "CLI behavior",
      scenario: "Primary command flow succeeds",
      severity: "warn",
      app: { kind: "tui", command: "node", args: [command] },
      given: [],
      when: [{ stdin: { text: "--help\n" } }],
      then: [{ stdout_contains: "Usage" }],
    },
    confidence,
    reason,
  );
}

function behaviorProposals(map) {
  if (map.coverage.current.behavior > 0) return [];
  if (map.detected.ui_routes.length > 0) {
    const route = map.detected.ui_routes[0];
    return [behaviorProposalForWeb(route, "medium", `A primary route ${route} was detected but no behavior scenario exists yet.`)];
  }
  if (map.detected.api_endpoints.length > 0) {
    const match = map.detected.api_endpoints[0].match(/^(GET|POST|PUT|PATCH|DELETE|FETCH)\s+(.+)$/);
    if (match) {
      const method = match[1] === "FETCH" ? "GET" : match[1];
      return [behaviorProposalForApi(method, match[2], "medium", `A primary API endpoint ${method} ${match[2]} was detected but no behavior scenario exists yet.`)];
    }
  }
  if ((map.detected.tui_signals || 0) > 0) {
    return [behaviorProposalForTui("./src/cli.js", "low", "CLI/TUI signals were detected, but the concrete entrypoint still needs review.")];
  }
  return [];
}

function dbProposals(map) {
  if (map.coverage.current.database > 0 || map.detected.db_tables.length === 0) return [];
  const table = map.detected.db_tables[0];
  return [
    fileProposal(
      "database",
      `vp/db/${slugify(`seed-${table}`)}.yml`,
      {
        id: slugify(`db-seed-${table}`),
        title: `${table} seed state is queryable`,
        severity: "warn",
        app: { kind: "db", engine: "sqlite", connection: "./test.db" },
        query: `SELECT * FROM ${table}`,
        assert: [{ row_count_gte: 0 }],
      },
      "low",
      `Table ${table} was detected, but engine/connection details remain ambiguous.`,
    ),
  ];
}

function securityProposals(map) {
  if (map.coverage.current.security > 0 || (map.detected.auth_signals + map.detected.security_signals) === 0) return [];
  const apiPath = map.detected.api_endpoints.find(endpoint => endpoint.startsWith("GET /api/"))?.replace(/^GET\s+/, "") || "/api/admin";
  return [
    fileProposal(
      "security",
      `vp/security/${slugify(`unauthenticated-${apiPath}`)}.yml`,
      {
        id: slugify(`security-unauthenticated-${apiPath}`),
        title: `${apiPath} rejects unauthenticated access`,
        severity: "warn",
        category: inferSecurityCategory("", apiPath),
        app: { kind: "security", base_url: "http://localhost:3000" },
        request: { method: "GET", path: apiPath },
        assert: [
          { status: 401 },
          { body_not_contains: "stack trace" },
        ],
      },
      "medium",
      `Auth/security signals were detected and ${apiPath} is a reasonable first rejection check.`,
    ),
  ];
}

function performanceProposals(map) {
  if (map.coverage.current.performance > 0) return [];
  if (map.detected.api_endpoints.length === 0 && map.detected.ui_routes.length === 0) return [];
  const endpoint = map.detected.api_endpoints.find(e => e.startsWith("GET "))?.replace(/^GET\s+/, "") || map.detected.ui_routes[0] || "/";
  const scenario = buildPerformanceScenario(endpoint);
  return [
    fileProposal(
      "performance",
      `vp/nfr/${slugify(`baseline-${endpoint}`)}.yml`,
      {
        id: slugify(`performance-baseline-${endpoint}`),
        title: `${endpoint} meets a baseline performance budget`,
        severity: "warn",
        app: { kind: "nfr", base_url: "http://localhost:3000" },
        scenario,
      },
      "medium",
      `Performance baseline coverage is missing for ${endpoint}.`,
    ),
  ];
}

function technicalProposals(map, cwd) {
  if (map.coverage.current.technical > 0) return [];
  const signals = collectSignals(cwd);
  const proposals = [];
  const detectedArchitectureFramework = chooseTechnicalArchitectureFramework(signals);
  const protocol = buildDetectedProtocolProposal(map);
  if (protocol) proposals.push(protocol);

  if (signals.packageJson) {
    const depAssertions = [...detectedStackAssertions(signals)];
    if (signals.hasPlaywright) depAssertions.push({ dependency_present: { name: "@playwright/test", section: "devDependencies" } });
    if (signals.hasTsArch) depAssertions.push({ dependency_present: { name: "tsarch", section: "devDependencies" } });
    if (signals.hasDepCruiser) depAssertions.push({ dependency_present: { name: "dependency-cruiser", section: "devDependencies" } });
    if (signals.hasMadge) depAssertions.push({ dependency_present: { name: "madge", section: "devDependencies" } });
    if (signals.hasBoundaries) depAssertions.push({ dependency_present: { name: "eslint-plugin-boundaries", section: "devDependencies" } });
    if (signals.packageManager) {
      const manager = signals.packageManager.split("@")[0];
      depAssertions.push({ json_matches: { path: "package.json", query: "$.packageManager", matches: `^${manager}@` } });
    }
    for (const scriptName of ["dev", "build", "test", "test:e2e", "lint"]) {
      if (typeof signals.scripts[scriptName] === "string") {
        depAssertions.push({ script_present: { name: scriptName } });
      }
    }
    if (signals.nextConfig) depAssertions.push({ path_exists: { path: signals.nextConfig } });

    const stackAssertions = dedupeAssertions(depAssertions);

    if (stackAssertions.length > 0) {
      proposals.push(fileProposal(
        "technical",
        "vp/technical/framework-stack.yml",
        {
          id: "technical-framework-stack",
          title: "Declared technical stack stays consistent",
          severity: "blocker",
          category: "framework",
          runner: { kind: "custom", framework: "custom" },
          app: { kind: "technical", root: "." },
          assert: [{ path_exists: { path: "package.json" } }, ...stackAssertions],
        },
        "high",
        "package.json exposes concrete framework/tooling choices.",
      ));
    }
  }

  if (detectedArchitectureFramework) {
    const architecture = buildArchitectureProposal(
      cwd,
      map,
      detectedArchitectureFramework,
      "medium",
      `Repository tooling already declares ${detectedArchitectureFramework}, so ShipFlow can draft a backend-native architecture check.`,
    );
    if (architecture) proposals.push(architecture);
  }

  if (signals.workflows.length > 0) {
    const workflow = signals.workflows[0];
    proposals.push(fileProposal(
      "technical",
      "vp/technical/ci-workflow.yml",
      {
        id: "technical-ci-workflow",
        title: "Repository keeps the expected CI workflow",
        severity: "blocker",
        category: "ci",
        runner: { kind: "custom", framework: "custom" },
        app: { kind: "technical", root: "." },
        assert: [
          { path_exists: { path: workflow } },
          { github_action_uses: { workflow, action: "actions/checkout@v4" } },
        ],
      },
      "high",
      `Workflow ${workflow} exists and can be validated concretely.`,
    ));
  }

  if (signals.hasBrowserstack || signals.hasSauce || signals.hasPercy || signals.hasDetox || signals.hasMaestro) {
    const tooling = [];
    if (signals.hasBrowserstack) tooling.push({ dependency_present: { name: signals.depNames.find(n => n.includes("browserstack")), section: "all" } });
    if (signals.hasSauce) tooling.push({ dependency_present: { name: signals.depNames.find(n => n.includes("sauce")), section: "all" } });
    if (signals.hasPercy) tooling.push({ dependency_present: { name: signals.depNames.find(n => n.includes("percy")), section: "all" } });
    if (signals.hasDetox) tooling.push({ dependency_present: { name: "detox", section: "all" } });
    if (signals.hasMaestro) tooling.push({ dependency_present: { name: signals.depNames.find(n => n.includes("maestro")), section: "all" } });
    if (signals.playwrightConfig) tooling.push({ path_exists: { path: signals.playwrightConfig } });
    if (signals.browserstackConfig) tooling.push({ path_exists: { path: signals.browserstackConfig } });
    if (signals.sauceConfig) tooling.push({ path_exists: { path: signals.sauceConfig } });
    if (signals.percyConfig) tooling.push({ path_exists: { path: signals.percyConfig } });
    if (typeof signals.scripts["test:e2e"] === "string") tooling.push({ script_present: { name: "test:e2e" } });
    if (typeof signals.scripts["test:visual"] === "string") tooling.push({ script_present: { name: "test:visual" } });
    proposals.push(fileProposal(
      "technical",
      "vp/technical/testing-tooling.yml",
      {
        id: "technical-testing-tooling",
        title: "Declared browser/mobile testing services remain configured",
        severity: "warn",
        category: "testing",
        runner: { kind: "custom", framework: "custom" },
        app: { kind: "technical", root: "." },
        assert: tooling,
      },
      "high",
      "Repository already declares browser/mobile testing tooling.",
    ));
  }

  return proposals;
}

function requestUiProposals(map, request) {
  if (map.coverage.current.ui > 0 || !request.inferred_types.includes("ui") || map.detected.ui_routes.length > 0) return [];
  if (requestNeedsDetailedTodoPack(request.raw)) {
    return buildTodoUiProposals();
  }
  const route = inferRequestedUiRoute(request.raw);
  const confidence = route !== "/" ? "medium" : "low";
  return [
    fileProposal(
      "ui",
      routeUiProposalPath(route),
      {
        id: routeUiProposalId(route),
        title: `${route} is reachable`,
        severity: "warn",
        app: { kind: "web", base_url: "http://localhost:3000" },
        flow: [{ open: route }],
        assert: [{ url_matches: { regex: route === "/" ? "/" : route } }],
      },
      confidence,
      `The request suggests a primary UI route at ${route}.`,
    ),
  ];
}

function requestBehaviorProposals(map, request) {
  if (map.coverage.current.behavior > 0) return [];
  const text = String(request.raw || "").toLowerCase();

  if (requestNeedsDetailedTodoPack(request.raw)
    && request.inferred_types.includes("api")
    && map.detected.api_endpoints.length === 0) {
    return [buildTodoBehaviorProposal()];
  }

  if (/\b(cli|terminal|tui|console|command line|shell)\b/.test(text)) {
    return [behaviorProposalForTui("./src/cli.js", "low", "The request explicitly mentions CLI or TUI behavior, but the command entrypoint still needs review.")];
  }

  if (request.inferred_types.includes("api") && map.detected.api_endpoints.length === 0) {
    const inferred = inferRequestedApiRequests(request.raw)[0];
    if (inferred) {
      return [behaviorProposalForApi(inferred.method, inferred.path, inferred.confidence, `The request suggests an API behavior flow around ${inferred.method} ${inferred.path}.`)];
    }
  }

  if (!request.inferred_types.includes("ui") || map.detected.ui_routes.length > 0) return [];
  const route = inferRequestedUiRoute(request.raw);
  const confidence = route !== "/" ? "medium" : "low";
  return [
    fileProposal(
      "behavior",
      routeBehaviorProposalPath(route),
      {
        id: routeBehaviorProposalId(route),
        feature: "Requested user flow",
        scenario: `User can reach ${route}`,
        severity: "warn",
        app: { kind: "web", base_url: "http://localhost:3000" },
        given: [{ open: route }],
        when: [],
        then: [{ url_matches: { regex: route === "/" ? "/" : route } }],
      },
      confidence,
      `The request suggests a user flow that begins at ${route}.`,
    ),
  ];
}

function requestApiProposals(map, request) {
  if (map.coverage.current.api > 0 || !request.inferred_types.includes("api") || map.detected.api_endpoints.length > 0) return [];
  return inferRequestedApiRequests(request.raw).map(inferred => {
    if (requestNeedsDetailedTodoPack(request.raw) && inferred.path === "/api/todos" && (inferred.method === "GET" || inferred.method === "POST")) {
      const contract = buildApiStarterContract(inferred.method, inferred.path, request.raw);
      return fileProposal(
        "api",
        inferred.method === "GET" ? "vp/api/get-todos.yml" : "vp/api/post-todos.yml",
        {
          id: inferred.method === "GET" ? "api-get-todos" : "api-post-todos",
          title: inferred.method === "GET" ? "GET /api/todos returns the todo list" : "POST /api/todos creates a todo",
          severity: "blocker",
          app: { kind: "api", base_url: "http://localhost:3000" },
          request: contract.request,
          assert: contract.assert,
        },
        "high",
        inferred.method === "GET"
          ? "The request explicitly describes todo listing over REST, so ShipFlow can draft a concrete list contract."
          : "The request explicitly describes todo creation over REST, so ShipFlow can draft a concrete create contract.",
      );
    }
    const contract = buildApiStarterContract(inferred.method, inferred.path, request.raw);
    return fileProposal(
      "api",
      apiProposalPath(inferred.method, inferred.path),
      {
        id: apiProposalId(inferred.method, inferred.path),
        title: `${inferred.method} ${inferred.path} keeps its requested contract`,
        severity: "warn",
        app: { kind: "api", base_url: "http://localhost:3000" },
        request: contract.request,
        assert: contract.assert,
      },
      inferred.confidence,
      inferred.reason,
    );
  });
}

function requestDbProposals(map, request) {
  if (map.coverage.current.database > 0 || !request.inferred_types.includes("database") || map.detected.db_tables.length > 0) return [];
  const engine = inferRequestedDbEngine(request.raw);
  if (!["sqlite", "postgresql"].includes(engine)) return [];

  const relPath = dbProposalPathForRequest(request.raw, engine);
  return [
    fileProposal(
      "database",
      relPath,
      buildRequestedDbStarter(request.raw, engine),
      "medium",
      `The request explicitly mentions ${engine}, so ShipFlow can draft a deterministic data lifecycle check with setup, mutation, and cleanup.`,
    ),
  ];
}

function requestPerformanceProposals(map, request) {
  if (map.coverage.current.performance > 0 || !request.inferred_types.includes("performance") || map.detected.ui_routes.length > 0 || map.detected.api_endpoints.length > 0) return [];
  const target = pickRequestedPerformanceTarget(request.raw);
  const scenarios = buildPerformanceScenarios(target.endpoint, target.method, request.raw);
  return scenarios.map(({ profileKey, proposalKey, scenario }) =>
    fileProposal(
      "performance",
      performanceProposalPath(proposalKey, target.endpoint),
      {
        id: performanceProposalId(proposalKey, target.endpoint),
        title: `${target.endpoint} meets the requested ${proposalKey} performance budget`,
        severity: "warn",
        app: { kind: "nfr", base_url: "http://localhost:3000" },
        scenario,
      },
      target.endpoint !== "/" ? "medium" : "low",
      profileKey === "smoke" && scenarios.length > 1
        ? `The request asks for performance coverage, so ShipFlow drafts a baseline for ${target.endpoint} before the requested ${scenarios[1].proposalKey} profile.`
        : `The request asks for ${proposalKey} performance coverage, and ${target.endpoint} is a concrete target for it.`,
    )
  );
}

function requestSecurityProposals(map, request) {
  if (map.coverage.current.security > 0 || !request.inferred_types.includes("security") || (map.detected.auth_signals + map.detected.security_signals) > 0) return [];
  const text = request.raw.toLowerCase();
  const protectedPath = inferProtectedApiPath(request.raw);
  const confidence = extractRequestedPaths(request.raw).some(item => item === protectedPath)
    || /\b(admin|role|permission|protected|authz|authorization|profile|account|session|token|login|signin|auth)\b/.test(text)
    ? "medium"
    : "low";
  return [
    fileProposal(
      "security",
      securityProtectionProposalPath(protectedPath),
      {
        id: securityProtectionProposalId(protectedPath),
        title: `${protectedPath} rejects unauthenticated access`,
        severity: "blocker",
        category: inferSecurityCategory(request.raw, protectedPath),
        app: { kind: "security", base_url: "http://localhost:3000" },
        request: { method: "GET", path: protectedPath },
        assert: [
          { status: 401 },
          { body_not_contains: "stack trace" },
        ],
      },
      confidence,
      `The request suggests a protected API surface at ${protectedPath}.`,
    ),
  ];
}

function requestTechnicalProposals(map, request, cwd) {
  if (map.coverage.current.technical > 0 || !request.inferred_types.includes("technical")) return [];
  const { frameworkAssertions, deliveryAssertions } = buildRequestTechnicalAssertions(request.raw);
  const proposals = [];
  const lower = request.raw.toLowerCase();
  const wantsArchitecture = /\b(architecture|boundaries|layering|layers|module boundaries|dependency graph)\b/.test(lower);
  const wantsDelivery = requestMentionsDeliveryTestingStack(request.raw);
  const requestedFramework = chooseTechnicalArchitectureFramework({
    hasDepCruiser: /\bdependency-cruiser\b/.test(lower),
    hasTsArch: /\btsarch\b/.test(lower),
    hasBoundaries: /\beslint-plugin-boundaries\b/.test(lower),
    hasMadge: /\bmadge\b/.test(lower),
  });
  const sqliteRuntime = buildRequestedSqliteRuntimeProposal(cwd, request);
  const signals = collectSignals(cwd);

  if (sqliteRuntime) proposals.push(sqliteRuntime);

  if (frameworkAssertions.length > 0) {
    const alreadyHasDetectedFrameworkStack = signals.packageJson
      && detectedStackAssertions(signals).length > 0;
    if (!alreadyHasDetectedFrameworkStack) {
      proposals.push(fileProposal(
        "technical",
        "vp/technical/framework-stack.yml",
        {
          id: "technical-framework-stack",
          title: "Requested framework and tooling stay in place",
          severity: "blocker",
          category: "framework",
          runner: { kind: "custom", framework: "custom" },
          app: { kind: "technical", root: "." },
          assert: [{ path_exists: { path: "package.json" } }, ...frameworkAssertions],
        },
        "medium",
        "The request names concrete frameworks or architecture tooling that can be enforced directly.",
      ));
    }
  }

  if (requestedFramework) {
    const architecture = buildArchitectureProposal(
      cwd,
      map,
      requestedFramework,
      "medium",
      `The request explicitly names ${requestedFramework}, so ShipFlow can draft a backend-native architecture verification.`,
    );
    if (architecture) proposals.push(architecture);
  } else if (wantsArchitecture) {
    const architecture = buildArchitectureProposal(
      cwd,
      map,
      "custom",
      "low",
      "The request asks for architecture constraints, but the backend choice still needs clarification before ShipFlow should auto-write the starter.",
    );
    if (architecture) proposals.push(architecture);
  }

  const protocol = buildRequestedProtocolProposal(map, request);
  const detectedProtocol = map.detected?.protocols || {};
  if (protocol && !detectedProtocol.graphql?.detected && !detectedProtocol.rest?.detected) proposals.push(protocol);

  if (deliveryAssertions.length > 0 || wantsDelivery) {
    const genericAssertions = [];
    if (signals.packageJson || pathExists(cwd, "package.json")) genericAssertions.push({ path_exists: { path: "package.json" } });
    if (typeof signals.scripts["test:e2e"] === "string") genericAssertions.push({ script_present: { name: "test:e2e" } });
    if (typeof signals.scripts["test:visual"] === "string") genericAssertions.push({ script_present: { name: "test:visual" } });
    if (signals.playwrightConfig) genericAssertions.push({ path_exists: { path: signals.playwrightConfig } });
    const assertions = dedupeAssertions([
      ...genericAssertions,
      ...deliveryAssertions,
    ]);
    const hasConcreteDeliveryChoice = requestMentionsConcreteDeliveryChoice(request.raw) || deliveryAssertions.length > 0;
    proposals.push(fileProposal(
      "technical",
      "vp/technical/delivery-stack.yml",
      {
        id: "technical-delivery-stack",
        title: hasConcreteDeliveryChoice
          ? "Requested CI and delivery constraints stay in place"
          : "Requested delivery and testing stack stays reviewable",
        severity: "blocker",
        category: "testing",
        runner: { kind: "custom", framework: "custom" },
        app: { kind: "technical", root: "." },
        assert: assertions.length > 0 ? assertions : [{ path_exists: { path: "package.json" } }],
      },
      hasConcreteDeliveryChoice ? "medium" : "low",
      hasConcreteDeliveryChoice
        ? "The request names concrete CI or infrastructure constraints that can be checked directly."
        : "The request adds delivery or browser/device testing scope, but the concrete platform still needs clarification before ShipFlow should auto-write it.",
    ));
  }

  return proposals;
}

export function buildDraft(cwd, request = "") {
  const map = buildMap(cwd, request);
  const lint = runLint(cwd);
  const requestContext = map.request || { raw: String(request || "").trim(), inferred_types: [], gaps: [], ambiguities: [], recommendations: [] };
  const ui = uiProposals(map);
  const behavior = behaviorProposals(map);
  const api = apiProposals(map);
  const database = dbProposals(map);
  const performance = performanceProposals(map);
  const security = securityProposals(map);
  const technical = technicalProposals(map, cwd);
  const proposals = [
    ...ui,
    ...(ui.length === 0 ? requestUiProposals(map, requestContext) : []),
    ...behavior,
    ...(behavior.length === 0 ? requestBehaviorProposals(map, requestContext) : []),
    ...api,
    ...(api.length === 0 ? requestApiProposals(map, requestContext) : []),
    ...database,
    ...(database.length === 0 ? requestDbProposals(map, requestContext) : []),
    ...performance,
    ...(performance.length === 0 ? requestPerformanceProposals(map, requestContext) : []),
    ...security,
    ...(security.length === 0 ? requestSecurityProposals(map, requestContext) : []),
    ...technical,
    ...requestTechnicalProposals(map, requestContext, cwd),
  ];
  const uniqueProposals = dedupeProposalsByPath(proposals);
  const clarifications = buildDraftClarifications(map, requestContext, cwd);
  const clarifiedProposals = attachClarificationsToProposals(uniqueProposals, clarifications);

  return {
    map,
    lint,
    request: requestContext,
    proposals: clarifiedProposals,
    clarifications,
    summary: {
      current_errors: lint.summary.errors,
      current_warnings: lint.summary.warnings,
      proposed_files: clarifiedProposals.length,
      high_confidence: clarifiedProposals.filter(p => p.confidence === "high").length,
      medium_confidence: clarifiedProposals.filter(p => p.confidence === "medium").length,
      low_confidence: clarifiedProposals.filter(p => p.confidence === "low").length,
    },
    ambiguities: map.ambiguities || [],
  };
}

const AiDraftSchema = z.object({
  summary: z.string().optional(),
  gaps: z.array(z.string()).optional(),
  ambiguities: z.array(z.string()).optional(),
  proposals: z.array(z.object({
    type: z.enum(["ui", "behavior", "api", "database", "performance", "security", "technical"]),
    path: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    reason: z.string(),
    data: z.record(z.unknown()),
  }).strict()).optional(),
}).strict();

export function resolveDraftOptions(cwd, overrides = {}, deps = {}) {
  const config = readConfig(cwd);
  const provider = overrides.provider || process.env.SHIPFLOW_DRAFT_PROVIDER || config.draft?.provider || "local";
  const aiProviderConfig = config.draft?.aiProvider || config.impl?.provider || "auto";
  const aiProvider = provider === "local"
    ? resolveProviderName(aiProviderConfig, cwd, deps)
    : resolveProviderName(provider, cwd, deps);
  const model = resolveProviderModel(config.draft, aiProvider, {
    model: overrides.model,
    envModel: process.env.SHIPFLOW_DRAFT_MODEL,
    legacyModel: typeof config.models?.verification === "string" ? config.models.verification : null,
  });
  const timeoutMs = config.draft?.timeoutMs || config.impl?.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS;
  const providerOptions = aiProvider === "command"
    ? { command: config.draft?.command || config.impl?.command || null }
    : {};
  return { config, provider, aiProvider, model, timeoutMs, providerOptions };
}

export function buildDraftPrompt(result) {
  const lines = [];
  lines.push("You are refining a ShipFlow verification drafting workflow.");
  lines.push("Use the local repo map, current lint state, and candidate verification proposals.");
  lines.push("Return ONLY JSON matching this shape:");
  lines.push(`{"summary":"...", "gaps":["..."], "ambiguities":["..."], "proposals":[{"type":"ui|behavior|api|database|performance|security|technical","path":"vp/...","confidence":"high|medium|low","reason":"...","data":{}}]}`);
  lines.push("");
  lines.push("Constraints:");
  lines.push("- Prefer precise, executable ShipFlow YAML data.");
  lines.push("- Proposals must be focused and automatable.");
  lines.push("- Keep paths stable and names clean.");
  lines.push("- Use full verification types; database not db, performance not nfr.");
  lines.push("- Do not explain outside JSON.");
  lines.push("");
  lines.push("User request:");
  lines.push(result.request?.raw || "(none)");
  lines.push("");
  lines.push("Request analysis:");
  lines.push(JSON.stringify(result.request || {}, null, 2));
  lines.push("");
  lines.push("Local map:");
  lines.push(JSON.stringify(result.map, null, 2));
  lines.push("");
  lines.push("Local lint:");
  lines.push(JSON.stringify(result.lint, null, 2));
  lines.push("");
  lines.push("Local candidate verification proposals:");
  lines.push(JSON.stringify(result.proposals, null, 2));
  lines.push("");
  lines.push("Clarifications:");
  lines.push(JSON.stringify(result.clarifications || [], null, 2));
  return lines.join("\n");
}

export function parseAiDraftResponse(text) {
  const raw = normalizeProviderText(text, "json");
  return AiDraftSchema.parse(JSON.parse(raw));
}

function normalizeAiProposal(proposal) {
  return {
    ...proposal,
    source: "ai",
  };
}

function buildValidationIssue(level, code, message) {
  return { level, code, message };
}

const AUTO_WRITE_BLOCKING_WARNING_CODES = new Set([
  "behavior.missing_when",
  "db.no_setup",
  "draft.path_exists",
  "draft.clarification_required",
]);

function requestAllowsAiChoice(raw) {
  return /\b(you choose|your choice|pick the best fit|choose the best fit|i leave it to you|leave it to you|je te laisse choisir|laisse le choix|choisis pour moi)\b/i.test(String(raw || ""));
}

function buildDraftClarifications(map, request, cwd) {
  const raw = String(request?.raw || "");
  if (!raw.trim() || requestAllowsAiChoice(raw)) return [];

  const signals = collectSignals(cwd);
  const brownfield = Boolean(signals.packageJson)
    || (map.detected?.ui_routes?.length || 0) > 0
    || (map.detected?.api_endpoints?.length || 0) > 0
    || (map.detected?.db_tables?.length || 0) > 0
    || (map.detected?.technical_files?.length || 0) > 0;
  if (!brownfield) return [];

  const clarifications = [];
  const lower = raw.toLowerCase();
  const requestedFramework = chooseTechnicalArchitectureFramework({
    hasDepCruiser: /\bdependency-cruiser\b/.test(lower),
    hasTsArch: /\btsarch\b/.test(lower),
    hasBoundaries: /\beslint-plugin-boundaries\b/.test(lower),
    hasMadge: /\bmadge\b/.test(lower),
  });
  const requestedProtocol = inferRequestedApiProtocol(raw);
  const repoProtocols = map.detected?.protocols || {};
  const repoProtocolIsClear = Boolean(repoProtocols.graphql?.detected) !== Boolean(repoProtocols.rest?.detected);

  if (requestMentionsDeliveryTestingStack(raw) && !requestMentionsConcreteDeliveryChoice(raw)) {
    clarifications.push({
      id: "technical-delivery-choice",
      question: "Which delivery or testing platform should these new brownfield verifications enforce?",
      reason: "The request adds delivery or testing infrastructure but does not name a concrete platform.",
      choices: ["keep existing stack", "browserstack", "sauce", "percy", "github-actions"],
      blocking_types: ["technical"],
    });
  }

  if (/\b(architecture|boundaries|layering|layers|module boundaries|dependency graph)\b/i.test(raw) && !requestedFramework) {
    clarifications.push({
      id: "technical-architecture-runner",
      question: "Should ShipFlow use its built-in technical assertions, or a dedicated architecture test backend?",
      reason: "The request asks for architecture constraints but does not name a verification backend.",
      choices: ["shipflow-built-in", "tsarch", "dependency-cruiser", "madge", "eslint-plugin-boundaries"],
      blocking_types: ["technical"],
    });
  }

  if (/\b(api|backend|service)\b/i.test(raw) && !requestedProtocol && !repoProtocolIsClear) {
    clarifications.push({
      id: "api-protocol-choice",
      question: "Should the new surface be verified as REST or GraphQL?",
      reason: "The request asks for API/backend work, but the protocol choice is not explicit and the repo does not make it obvious.",
      choices: ["rest", "graphql"],
      blocking_types: ["api", "behavior", "technical"],
    });
  }

  if (/\b(database|storage|persistence)\b/i.test(raw) && !inferRequestedDbEngine(raw) && (map.detected?.db_tables?.length || 0) === 0) {
    clarifications.push({
      id: "database-engine-choice",
      question: "Which database or persistence engine should the new capability use?",
      reason: "The request adds persistence, but the target engine is not explicit and no existing database signal was detected.",
      choices: ["sqlite", "postgresql", "reuse existing runtime"],
      blocking_types: ["database", "technical"],
    });
  }

  return clarifications;
}

function attachClarificationsToProposals(proposals, clarifications) {
  if (!Array.isArray(clarifications) || clarifications.length === 0) return proposals;
  return proposals.map(proposal => {
    const clarificationIds = clarifications
      .filter(item => Array.isArray(item.blocking_types) && item.blocking_types.includes(proposal.type))
      .map(item => item.id);
    if (clarificationIds.length === 0) return proposal;
    return {
      ...proposal,
      clarification_ids: clarificationIds,
    };
  });
}

function validateProposalPath(cwd, proposalPath) {
  const normalized = String(proposalPath || "").replaceAll("\\", "/");
  if (!normalized.startsWith("vp/")) {
    return {
      ok: false,
      path: normalized,
      issues: [buildValidationIssue("error", "draft.path_outside_vp", "Starter path must stay under vp/.")],
    };
  }
  if (!normalized.endsWith(".yml") && !normalized.endsWith(".yaml")) {
    return {
      ok: false,
      path: normalized,
      issues: [buildValidationIssue("error", "draft.path_extension", "Starter path must end with .yml or .yaml.")],
    };
  }
  const resolved = path.resolve(cwd, normalized);
  const vpRoot = path.resolve(cwd, "vp");
  if (!(resolved === vpRoot || resolved.startsWith(vpRoot + path.sep))) {
    return {
      ok: false,
      path: normalized,
      issues: [buildValidationIssue("error", "draft.path_escape", "Starter path escapes the vp/ directory.")],
    };
  }
  return { ok: true, path: normalized, resolved };
}

function validateProposals(cwd, proposals, options = {}) {
  const updateExisting = options.updateExisting === true;
  const clarificationsById = new Map((options.clarifications || []).map(item => [item.id, item]));
  if (proposals.length === 0) {
    return {
      proposals,
      summary: { valid: 0, invalid: 0, blocked_existing: 0, needs_review: 0 },
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-draft-validate-"));
  try {
    const vpSrc = path.join(cwd, "vp");
    const vpDest = path.join(tmpDir, "vp");
    if (fs.existsSync(vpSrc)) fs.cpSync(vpSrc, vpDest, { recursive: true });
    else mkdirp(vpDest);

    const perPath = new Map();
    const pendingLintPaths = new Set();

    for (const proposal of proposals) {
      const pathCheck = validateProposalPath(cwd, proposal.path);
      const existing = pathCheck.ok && fs.existsSync(pathCheck.resolved);
      const issues = [...(pathCheck.issues || [])];
      let writable = pathCheck.ok && (!existing || updateExisting);

      if (existing) {
        issues.push(buildValidationIssue(
          "warn",
          "draft.path_exists",
          updateExisting
            ? "Starter path already exists; only explicitly accepted proposals can replace it with --update-existing."
            : "Starter path already exists; ShipFlow will not overwrite it unless --update-existing is used.",
        ));
      }

      const requiredClarifications = Array.isArray(proposal.clarification_ids)
        ? proposal.clarification_ids.map(id => clarificationsById.get(id)).filter(Boolean)
        : [];
      if (requiredClarifications.length > 0) {
        issues.push(buildValidationIssue(
          "warn",
          "draft.clarification_required",
          `Resolve clarification(s) before auto-write: ${requiredClarifications.map(item => item.question).join(" | ")}`,
        ));
      }

      if (writable) {
        const tempPath = path.join(tmpDir, pathCheck.path);
        mkdirp(path.dirname(tempPath));
        writeFile(tempPath, yaml.dump(proposal.data, { noRefs: true, lineWidth: 120 }));
        pendingLintPaths.add(pathCheck.path);
      }

      perPath.set(proposal.path, {
        normalizedPath: pathCheck.path,
        writable,
        existing,
        issues,
      });
    }

    if (pendingLintPaths.size > 0) {
      const lint = runLint(tmpDir);
      for (const issue of lint.issues) {
        if (!pendingLintPaths.has(issue.file)) continue;
        const current = perPath.get(issue.file) || perPath.get(issue.file.replaceAll("\\", "/"));
        if (!current) continue;
        current.issues.push(buildValidationIssue(issue.level, issue.code, issue.message));
      }
    }

    const validated = proposals.map(proposal => {
      const current = perPath.get(proposal.path);
      const hasError = current.issues.some(issue => issue.level === "error");
      const needsReview = current.issues.some(issue => issue.level === "warn" && AUTO_WRITE_BLOCKING_WARNING_CODES.has(issue.code));
      return {
        ...proposal,
        validation: {
          ok: !hasError,
          writable: current.writable && !hasError,
          auto_write: current.writable && !hasError && !needsReview,
          existing: current.existing,
          updatable: current.existing && updateExisting && !hasError,
          issues: current.issues,
        },
      };
    });

    return {
      proposals: validated,
      summary: {
        valid: validated.filter(proposal => proposal.validation.ok).length,
        invalid: validated.filter(proposal => !proposal.validation.ok).length,
        blocked_existing: validated.filter(proposal => proposal.validation.ok && !proposal.validation.writable).length,
        needs_review: validated.filter(proposal => proposal.validation.ok && proposal.validation.auto_write === false).length,
      },
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function applyReviewState(proposals, previousSession) {
  const previousByPath = new Map(
    (previousSession?.proposals || [])
      .filter(proposal => proposal?.path)
      .map(proposal => [proposal.path, proposal.review || {}])
  );

  return proposals.map(proposal => {
    const previous = previousByPath.get(proposal.path) || {};
    return {
      ...proposal,
      review: {
        decision: ["accept", "reject", "pending"].includes(previous.decision) ? previous.decision : "pending",
        note: typeof previous.note === "string" ? previous.note : "",
        suggested_write: proposal.confidence !== "low" && proposal.validation?.auto_write === true,
      },
    };
  });
}

function normalizeReviewPaths(paths) {
  return [...new Set((paths || [])
    .flatMap(value => String(value || "").split(","))
    .map(value => value.trim().replaceAll("\\", "/"))
    .filter(Boolean))];
}

function validateReviewArgs(updates = {}) {
  const accept = normalizeReviewPaths(updates.accept);
  const reject = normalizeReviewPaths(updates.reject);
  const pending = normalizeReviewPaths(updates.pending);
  const conflicts = [];
  const buckets = [
    ["accept", accept],
    ["reject", reject],
    ["pending", pending],
  ];

  for (let i = 0; i < buckets.length; i += 1) {
    for (let j = i + 1; j < buckets.length; j += 1) {
      const [leftLabel, leftPaths] = buckets[i];
      const [rightLabel, rightPaths] = buckets[j];
      const overlap = leftPaths.filter(item => rightPaths.includes(item));
      for (const item of overlap) {
        conflicts.push(`Proposal path ${item} appears in both --${leftLabel} and --${rightLabel}.`);
      }
    }
  }

  return {
    ok: conflicts.length === 0,
    accept,
    reject,
    pending,
    conflicts,
  };
}

function applyReviewUpdates(proposals, normalizedUpdates) {
  const accept = new Set(normalizedUpdates.accept);
  const reject = new Set(normalizedUpdates.reject);
  const pending = new Set(normalizedUpdates.pending);
  const matched = new Set();

  const reviewed = proposals.map(proposal => {
    const normalizedPath = String(proposal.path || "").replaceAll("\\", "/");
    let decision = proposal.review?.decision || "pending";
    if (accept.has(normalizedPath)) {
      decision = "accept";
      matched.add(normalizedPath);
    }
    if (reject.has(normalizedPath)) {
      decision = "reject";
      matched.add(normalizedPath);
    }
    if (pending.has(normalizedPath)) {
      decision = "pending";
      matched.add(normalizedPath);
    }
    return {
      ...proposal,
      review: {
        ...proposal.review,
        decision,
      },
    };
  });

  const requested = [...accept, ...reject, ...pending];
  const unmatched = requested.filter(item => !matched.has(item));
  return {
    proposals: reviewed,
    summary: {
      accepted: [...accept].filter(item => matched.has(item)).length,
      rejected: [...reject].filter(item => matched.has(item)).length,
      pending: [...pending].filter(item => matched.has(item)).length,
      unmatched,
    },
  };
}

function summarizeDraftSession(proposals) {
  return {
    accepted: proposals.filter(proposal => proposal.review?.decision === "accept").length,
    rejected: proposals.filter(proposal => proposal.review?.decision === "reject").length,
    pending: proposals.filter(proposal => proposal.review?.decision !== "accept" && proposal.review?.decision !== "reject").length,
    suggested_write: proposals.filter(proposal => proposal.review?.suggested_write).length,
  };
}

function buildDraftSession(result, sessionPath) {
  const summary = summarizeDraftSession(result.proposals);
  const vpSnapshot = computeVerificationPackSnapshot(result.cwd);
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    request: result.request?.raw || "",
    summary: result.summary,
    gaps: collectDraftGaps(result),
    ambiguities: result.ambiguities || [],
    clarifications: result.clarifications || [],
    proposal_validation: result.proposal_validation,
    review: summary,
    vp_snapshot: vpSnapshot,
    proposals: result.proposals.map(proposal => ({
      path: proposal.path,
      type: proposal.type,
      confidence: proposal.confidence,
      reason: proposal.reason,
      source: proposal.source || "local",
      data: proposal.data,
      review: proposal.review,
      validation: proposal.validation,
    })),
    written: result.written || [],
    session_path: path.relative(result.cwd, sessionPath).replaceAll("\\", "/"),
  };
}

function hasExplicitReview(proposals) {
  return proposals.some(proposal => proposal.review?.decision === "accept" || proposal.review?.decision === "reject");
}

function selectProposalsToWrite(proposals, options = {}) {
  const updateExisting = options.updateExisting === true;
  if (hasExplicitReview(proposals)) {
    return proposals.filter(proposal => proposal.review?.decision === "accept"
      && (proposal.validation?.auto_write || (updateExisting && proposal.validation?.updatable)));
  }
  return proposals.filter(proposal => proposal.confidence !== "low" && proposal.validation?.auto_write);
}

function persistDraftSession(cwd, result) {
  const file = draftSessionPath(cwd);
  const session = buildDraftSession({ ...result, cwd }, file);
  writeFile(file, JSON.stringify(session, null, 2) + "\n");
  return {
    path: path.relative(cwd, file).replaceAll("\\", "/"),
    ...session.review,
  };
}

export function seedDraftSession(cwd, request = "") {
  const result = buildDraft(cwd, request);
  const session = persistDraftSession(cwd, result);
  return { result, session };
}

function hasReviewUpdates(summary) {
  return Boolean(summary)
    && ((summary.accepted || 0) > 0
      || (summary.rejected || 0) > 0
      || (summary.pending || 0) > 0
      || (summary.unmatched?.length || 0) > 0);
}

function resolvedRequestSource(input, previousSession) {
  if (String(input || "").trim()) return "input";
  if (String(previousSession?.data?.request || "").trim()) return "session";
  return "local";
}

function canResumeSession(sessionState) {
  return sessionState.ok && sessionState.exists && sessionState.data;
}

function hasReviewFlags({ accept = [], reject = [], pending = [] }) {
  return accept.length > 0 || reject.length > 0 || pending.length > 0;
}

function canUseSessionProposals(sessionState) {
  return canResumeSession(sessionState)
    && Array.isArray(sessionState.data.proposals)
    && sessionState.data.proposals.every(proposal => proposal && proposal.path && proposal.data);
}

function buildDraftUsageError(message, json = false) {
  const result = { ok: false, error: message };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.error(message);
  return { exitCode: 2, result };
}

function buildDraftSuccess(result, json = false, write = false) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatHuman(result, write));
  }
  return { exitCode: 0, result };
}

function buildClearedSessionResult(cleared, json = false) {
  const result = {
    ok: true,
    cleared,
    session: null,
    proposals: [],
    written: [],
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(cleared
      ? "ShipFlow Draft\n\nDraft session cleared."
      : "ShipFlow Draft\n\nNo draft session to clear.");
  }
  return { exitCode: 0, result };
}

function mergeDraftResults(localResult, aiResult, options) {
  const merged = new Map();
  for (const proposal of localResult.proposals) {
    merged.set(proposal.path, proposal);
  }
  for (const proposal of aiResult.proposals || []) {
    merged.set(proposal.path, normalizeAiProposal(proposal));
  }

  return {
    ...localResult,
    proposals: [...merged.values()],
    ambiguities: [...new Set([...(localResult.ambiguities || []), ...(aiResult.ambiguities || [])])],
    clarifications: localResult.clarifications || [],
    ai: {
      enabled: true,
      provider: options.aiProvider,
      model: options.model || null,
      summary: aiResult.summary || null,
      gaps: aiResult.gaps || [],
    },
    summary: {
      ...localResult.summary,
      proposed_files: merged.size,
      high_confidence: [...merged.values()].filter(p => p.confidence === "high").length,
      medium_confidence: [...merged.values()].filter(p => p.confidence === "medium").length,
      low_confidence: [...merged.values()].filter(p => p.confidence === "low").length,
    },
  };
}

async function maybeEnhanceDraft(cwd, localResult, options, generateText = generateWithProvider) {
  if (options.provider === "local") {
    return {
      ...localResult,
      ai: {
        enabled: false,
        provider: "local",
        model: null,
        summary: null,
        gaps: [],
      },
    };
  }

  const prompt = buildDraftPrompt(localResult);
  const text = await generateText({
    provider: options.aiProvider,
    model: options.model,
    maxTokens: 16384,
    prompt,
    cwd,
    options: options.providerOptions,
    responseFormat: "json",
    timeoutMs: options.timeoutMs,
  });
  const aiResult = parseAiDraftResponse(text);
  return mergeDraftResults(localResult, aiResult, options);
}

function writeProposals(cwd, proposals, options = {}) {
  const updateExisting = options.updateExisting === true;
  const created = [];
  for (const proposal of proposals) {
    const full = path.join(cwd, proposal.path);
    if (fs.existsSync(full) && !updateExisting) continue;
    mkdirp(path.dirname(full));
    writeFile(full, yaml.dump(proposal.data, { noRefs: true, lineWidth: 120 }));
    created.push(proposal.path);
  }
  return created;
}

function formatHuman(result, writeMode) {
  const lines = [];
  lines.push("ShipFlow Draft");
  lines.push("");
  const requestLabel = result.request?.raw || "(none)";
  lines.push(`Requested scope: ${requestLabel}${result.request_source === "session" ? " [saved session]" : ""}`);
  lines.push(`Requested verification types: ${result.request?.inferred_types?.join(", ") || "(none inferred)"}`);
  lines.push("");
  lines.push("What the system understood:");
  lines.push(`  UI routes: ${result.map.detected.ui_routes.slice(0, 5).join(", ") || "(none)"}`);
  lines.push(`  API endpoints: ${result.map.detected.api_endpoints.slice(0, 5).join(", ") || "(none)"}`);
  lines.push(`  Database tables: ${result.map.detected.db_tables.slice(0, 5).join(", ") || "(none)"}`);
  lines.push(`  GraphQL protocol: ${result.map.detected.protocols?.graphql?.detected ? result.map.detected.protocols.graphql.endpoints.join(", ") || "detected" : "(none)"}`);
  lines.push(`  REST protocol: ${result.map.detected.protocols?.rest?.detected ? result.map.detected.protocols.rest.endpoints.join(", ") || "detected" : "(none)"}`);
  lines.push(`  Technical files: ${result.map.detected.technical_files.slice(0, 5).join(", ") || "(none)"}`);
  lines.push("");
  lines.push("Coverage gaps:");
  const gaps = collectDraftGaps(result);
  if (gaps.length === 0) lines.push("  (none detected)");
  else for (const gap of gaps) lines.push(`  - ${gap}`);
  lines.push("");
  lines.push("Ambiguities:");
  if (result.ambiguities.length === 0) lines.push("  (none detected)");
  else for (const item of result.ambiguities) lines.push(`  - ${item}`);
  lines.push("");
  lines.push("Clarifications:");
  if (!result.clarifications || result.clarifications.length === 0) lines.push("  (none required)");
  else for (const item of result.clarifications) lines.push(`  - [${item.id}] ${item.question} — ${item.reason}`);
  lines.push("");
  lines.push("Candidate verification proposals:");
  if (result.proposals.length === 0) lines.push("  (no proposal)");
  else {
    for (const proposal of result.proposals) {
      const status = proposal.validation?.ok === false
        ? " [invalid]"
        : proposal.validation?.existing
          ? proposal.validation?.updatable
            ? " [update]"
            : " [exists]"
          : proposal.validation?.writable === false
          ? " [exists]"
          : proposal.validation?.auto_write === false
            ? " [review]"
            : "";
      const decision = proposal.review?.decision && proposal.review.decision !== "pending"
        ? ` {${proposal.review.decision}}`
        : "";
      lines.push(`  - [${proposal.confidence}] ${proposal.path}${status}${decision} — ${proposal.reason}${proposal.source === "ai" ? " (AI)" : ""}`);
    }
  }
  if (result.proposal_validation) {
    lines.push("");
    lines.push("Proposal validation:");
    lines.push(`  Valid: ${result.proposal_validation.valid}`);
    lines.push(`  Invalid: ${result.proposal_validation.invalid}`);
    lines.push(`  Existing paths kept: ${result.proposal_validation.blocked_existing}`);
    lines.push(`  Needs review before auto-write: ${result.proposal_validation.needs_review}`);
    const invalid = result.proposals.filter(proposal => proposal.validation?.ok === false);
    for (const proposal of invalid) {
      for (const issue of proposal.validation.issues) {
        lines.push(`  - ${proposal.path}: ${issue.code} — ${issue.message}`);
      }
    }
  }
  if (result.ai?.enabled) {
    lines.push("");
    lines.push(`AI refinement: ${result.ai.provider}${result.ai.model ? ` / ${result.ai.model}` : ""}`);
    if (result.ai.summary) lines.push(`  ${result.ai.summary}`);
  }
  if (hasReviewUpdates(result.review_updates)) {
    lines.push("");
    lines.push("Review updates:");
    lines.push(`  Accepted: ${result.review_updates.accepted}`);
    lines.push(`  Rejected: ${result.review_updates.rejected}`);
    lines.push(`  Reset to pending: ${result.review_updates.pending}`);
    if (result.review_updates.unmatched.length > 0) {
      for (const item of result.review_updates.unmatched) {
        lines.push(`  - Unmatched path: ${item}`);
      }
    }
  }
  if (result.session) {
    lines.push("");
    lines.push(`Draft session: ${result.session.path}`);
    lines.push(`  Accepted: ${result.session.accepted}`);
    lines.push(`  Rejected: ${result.session.rejected}`);
    lines.push(`  Pending: ${result.session.pending}`);
    lines.push(`  Suggested for write: ${result.session.suggested_write}`);
    if (typeof result.session.ready_for_implement === "boolean") {
      lines.push(`  Ready for implement: ${result.session.ready_for_implement ? "yes" : "no"}`);
    }
    for (const reason of result.session.blocking_reasons || []) {
      lines.push(`  Blocked: ${reason}`);
    }
  }
  if (writeMode) {
    lines.push("");
    lines.push(`Written files: ${result.written.length ? result.written.join(", ") : "(none)"}`);
  } else {
    lines.push("");
    lines.push("Run `shipflow draft \"<user request>\" --write` to write the selected proposals into `vp/`.");
  }
  if (result.proposals.length > 0) {
    lines.push("");
    lines.push("Review flow:");
    lines.push("  shipflow draft --accept=<vp/path.yml>");
    lines.push("  shipflow draft --reject=<vp/path.yml>");
    lines.push("  shipflow draft --pending=<vp/path.yml>");
    lines.push("  shipflow draft --clear-session");
    lines.push("  shipflow draft --accept=<vp/path.yml> --write");
    lines.push("  shipflow draft --accept=<vp/path.yml> --update-existing --write");
  }
  return lines.join("\n");
}

export async function draft({ cwd, input = "", json = false, write = false, provider, model, ai = false, accept = [], reject = [], pending = [], updateExisting = false, clearSession = false, generateText }) {
  const explicitInput = String(input || "").trim();
  const hadSession = loadDraftSession(cwd);
  const cleared = clearSession ? clearDraftSession(cwd) : false;
  if (clearSession && !explicitInput && !write && !hasReviewFlags({ accept, reject, pending })) {
    return buildClearedSessionResult(cleared || hadSession.exists, json);
  }
  const sessionState = clearSession ? loadDraftSession(cwd) : hadSession;
  const normalizedReviewArgs = validateReviewArgs({ accept, reject, pending });
  if (!normalizedReviewArgs.ok) {
    return buildDraftUsageError(normalizedReviewArgs.conflicts.join(" "), json);
  }
  if (!explicitInput && hasReviewFlags(normalizedReviewArgs) && !canResumeSession(sessionState)) {
    const message = sessionState.exists && !sessionState.ok
      ? "shipflow draft review flags require a readable existing draft session or a new request."
      : "shipflow draft review flags require an existing draft session or a new request.";
    return buildDraftUsageError(message, json);
  }

  const resolvedInput = explicitInput || sessionState.data?.request || "";
  const requestSource = resolvedRequestSource(explicitInput, sessionState);
  const reviewOnlySessionAction = !explicitInput && (hasReviewFlags(normalizedReviewArgs) || write) && canUseSessionProposals(sessionState);
  const local = buildDraft(cwd, resolvedInput);
  const draftOptions = resolveDraftOptions(cwd, { provider, model });
  const effectiveOptions = ai && draftOptions.provider === "local"
    ? { ...draftOptions, provider: draftOptions.aiProvider }
    : draftOptions;
  const sessionResult = reviewOnlySessionAction
    ? {
        ...local,
        proposals: sessionState.data.proposals.map(proposal => ({ ...proposal })),
        ambiguities: sessionState.data.ambiguities || local.ambiguities,
        clarifications: sessionState.data.clarifications || local.clarifications || [],
        ai: {
          enabled: false,
          provider: "session",
          model: null,
          summary: null,
          gaps: [],
        },
        summary: {
          ...local.summary,
          proposed_files: sessionState.data.proposals.length,
          high_confidence: sessionState.data.proposals.filter(p => p.confidence === "high").length,
          medium_confidence: sessionState.data.proposals.filter(p => p.confidence === "medium").length,
          low_confidence: sessionState.data.proposals.filter(p => p.confidence === "low").length,
        },
      }
    : null;
  const result = sessionResult || (ai || draftOptions.provider !== "local"
    ? await maybeEnhanceDraft(cwd, local, effectiveOptions, generateText)
    : await maybeEnhanceDraft(cwd, local, draftOptions, generateText));
  const validated = validateProposals(cwd, result.proposals, {
    updateExisting,
    clarifications: result.clarifications || [],
  });
  const reusableSession = explicitInput && sessionState.data?.request && sessionState.data.request !== explicitInput
    ? null
    : sessionState.data;
  const baseReviewedProposals = applyReviewState(validated.proposals, reusableSession);
  const reviewUpdates = applyReviewUpdates(baseReviewedProposals, normalizedReviewArgs);
  if (!explicitInput && hasReviewFlags(normalizedReviewArgs) && reviewUpdates.summary.accepted === 0 && reviewUpdates.summary.rejected === 0
    && reviewUpdates.summary.pending === 0 && reviewUpdates.summary.unmatched.length > 0) {
    return buildDraftUsageError("No matching proposal paths were found in the current draft session.", json);
  }
  const reviewedProposals = reviewUpdates.proposals;
  const written = write
    ? writeProposals(cwd, selectProposalsToWrite(reviewedProposals, { updateExisting }), { updateExisting })
    : [];
  const session = persistDraftSession(cwd, {
    ...result,
    proposals: reviewedProposals,
    proposal_validation: validated.summary,
    written,
  });
  const draftSessionStatus = collectStatus(cwd).draft_session;
  const full = {
    ...result,
    proposals: reviewedProposals,
    proposal_validation: validated.summary,
    request_source: requestSource,
    review_updates: reviewUpdates.summary,
    cleared_session: cleared,
    written,
    session: {
      ...session,
      ready_for_implement: draftSessionStatus?.ready_for_implement ?? null,
      blocking_reasons: draftSessionStatus?.blocking_reasons || [],
    },
  };
  return buildDraftSuccess(full, json, write);
}
