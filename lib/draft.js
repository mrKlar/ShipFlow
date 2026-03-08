import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { buildMap } from "./map.js";
import { runLint } from "./lint.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { readConfig } from "./config.js";
import { generateWithProvider, resolveProviderModel, resolveProviderName } from "./providers/index.js";

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "draft";
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function listWorkflowFiles(cwd) {
  const dir = path.join(cwd, ".github", "workflows");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(f => `.github/workflows/${f}`);
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
  return {
    packageJson: pkg,
    depNames,
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
  };
}

function extractRequestedPaths(raw) {
  const matches = String(raw || "").match(/\/[a-z0-9/_-]*/gi) || [];
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

function inferRequestedApiRequest(raw) {
  const explicit = extractRequestedPaths(raw).find(item => item.startsWith("/api/"));
  if (explicit) return { method: "GET", path: explicit, confidence: "high", reason: `The request explicitly mentions API path ${explicit}.` };

  const text = String(raw || "").toLowerCase();
  if (/\badmin\b/.test(text)) return { method: "GET", path: "/api/admin", confidence: "medium", reason: "The request mentions an admin API surface." };
  if (/\b(login|sign in|signin)\b/.test(text)) return { method: "POST", path: "/api/login", confidence: "medium", reason: "The request mentions an authentication API surface." };
  if (/\b(sign up|signup|register)\b/.test(text)) return { method: "POST", path: "/api/signup", confidence: "medium", reason: "The request mentions a registration API surface." };
  if (/\b(todo|task)\b/.test(text)) return { method: "GET", path: "/api/todos", confidence: "medium", reason: "The request describes a todo-style API domain." };
  if (/\b(user|account|profile)\b/.test(text)) return { method: "GET", path: "/api/users", confidence: "medium", reason: "The request describes a user/account API domain." };
  return { method: "GET", path: "/api/health", confidence: "low", reason: "The request needs API coverage, but only a generic health-style starter can be inferred." };
}

function inferRequestedDbEngine(raw) {
  const text = String(raw || "").toLowerCase();
  if (/\bsqlite\b/.test(text)) return "sqlite";
  if (/\bpostgres|postgresql\b/.test(text)) return "postgresql";
  if (/\bmysql\b/.test(text)) return "mysql";
  return null;
}

function buildRequestTechnicalAssertions(raw) {
  const text = String(raw || "").toLowerCase();
  const frameworkAssertions = [];
  const deliveryAssertions = [];

  const dependencies = [
    { pattern: /\bnext(\.js)?\b/, name: "next" },
    { pattern: /\breact\b/, name: "react" },
    { pattern: /\bvue\b/, name: "vue" },
    { pattern: /\bangular\b/, name: "@angular/core" },
    { pattern: /\bsvelte\b/, name: "svelte" },
    { pattern: /\bexpress\b/, name: "express" },
    { pattern: /\bfastify\b/, name: "fastify" },
    { pattern: /\bnest(js)?\b/, name: "@nestjs/core" },
    { pattern: /\btsarch\b/, name: "tsarch" },
    { pattern: /\bdependency-cruiser\b/, name: "dependency-cruiser" },
    { pattern: /\bmadge\b/, name: "madge" },
    { pattern: /\beslint-plugin-boundaries\b/, name: "eslint-plugin-boundaries" },
    { pattern: /\bdetox\b/, name: "detox" },
    { pattern: /\bmaestro\b/, name: "maestro" },
  ];

  for (const dependency of dependencies) {
    if (dependency.pattern.test(text)) {
      frameworkAssertions.push({ dependency_present: { name: dependency.name, section: "all" } });
    }
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

function fileProposal(type, relPath, data, confidence, reason) {
  return { type, path: relPath, data, confidence, reason, source: "local" };
}

function uiProposals(map) {
  if (map.coverage.current.ui > 0) return [];
  return map.detected.ui_routes.slice(0, 3).map(route =>
    fileProposal(
      "ui",
      `vp/ui/${slugify(`route-${route}`)}.yml`,
      {
        id: slugify(`ui-route-${route}`),
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
    proposals.push(fileProposal(
      "api",
      `vp/api/${slugify(`${method.toLowerCase()}-${apiPath}`)}.yml`,
      {
        id: slugify(`api-${method.toLowerCase()}-${apiPath}`),
        title: `${method} ${apiPath} responds successfully`,
        severity: "warn",
        app: { kind: "api", base_url: "http://localhost:3000" },
        request: { method, path: apiPath },
        assert: apiPath.includes("/api/")
          ? [{ status: 200 }, { header_matches: { name: "content-type", matches: "json" } }]
          : [{ status: 200 }],
      },
      apiPath.includes("/api/") ? "medium" : "low",
      `Static analysis detected endpoint ${method} ${apiPath}.`,
    ));
  }
  return proposals;
}

function behaviorProposals(map) {
  if (map.coverage.current.behavior > 0 || map.detected.ui_routes.length === 0) return [];
  const route = map.detected.ui_routes[0];
  return [
    fileProposal(
      "behavior",
      `vp/behavior/${slugify(`main-flow-${route}`)}.yml`,
      {
        id: slugify(`behavior-main-flow-${route}`),
        feature: "Main user flow",
        scenario: `User can reach ${route}`,
        severity: "warn",
        app: { kind: "web", base_url: "http://localhost:3000" },
        given: [{ open: route }],
        when: [],
        then: [{ url_matches: { regex: route === "/" ? "/" : route } }],
      },
      "medium",
      `A primary route ${route} was detected but no behavior scenario exists yet.`,
    ),
  ];
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
  const endpoint = map.detected.api_endpoints.find(e => e.startsWith("GET "))?.replace(/^GET\s+/, "") || map.detected.ui_routes[0] || "/";
  return [
    fileProposal(
      "performance",
      `vp/nfr/${slugify(`smoke-${endpoint}`)}.yml`,
      {
        id: slugify(`performance-smoke-${endpoint}`),
        title: `${endpoint} meets smoke performance budget`,
        severity: "warn",
        app: { kind: "nfr", base_url: "http://localhost:3000" },
        scenario: {
          endpoint,
          method: "GET",
          thresholds: {
            http_req_duration_p95: 500,
            http_req_failed: 0.05,
          },
          vus: 10,
          duration: "15s",
        },
      },
      "medium",
      `Performance smoke coverage is missing for ${endpoint}.`,
    ),
  ];
}

function technicalProposals(map, cwd) {
  if (map.coverage.current.technical > 0) return [];
  const signals = collectSignals(cwd);
  const proposals = [];

  if (signals.packageJson) {
    const depAssertions = [];
    if (signals.hasPlaywright) depAssertions.push({ dependency_present: { name: "@playwright/test", section: "devDependencies" } });
    if (signals.hasTsArch) depAssertions.push({ dependency_present: { name: "tsarch", section: "devDependencies" } });
    if (signals.hasDepCruiser) depAssertions.push({ dependency_present: { name: "dependency-cruiser", section: "devDependencies" } });
    if (signals.hasMadge) depAssertions.push({ dependency_present: { name: "madge", section: "devDependencies" } });
    if (signals.hasBoundaries) depAssertions.push({ dependency_present: { name: "eslint-plugin-boundaries", section: "devDependencies" } });

    if (depAssertions.length > 0) {
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
          assert: [{ path_exists: { path: "package.json" } }, ...depAssertions],
        },
        "high",
        "package.json exposes concrete framework/tooling choices.",
      ));
    }
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
  const route = inferRequestedUiRoute(request.raw);
  const confidence = route !== "/" ? "medium" : "low";
  return [
    fileProposal(
      "ui",
      `vp/ui/${slugify(`requested-route-${route}`)}.yml`,
      {
        id: slugify(`ui-requested-route-${route}`),
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
  if (map.coverage.current.behavior > 0 || !request.inferred_types.includes("ui") || map.detected.ui_routes.length > 0) return [];
  const route = inferRequestedUiRoute(request.raw);
  const confidence = route !== "/" ? "medium" : "low";
  return [
    fileProposal(
      "behavior",
      `vp/behavior/${slugify(`requested-flow-${route}`)}.yml`,
      {
        id: slugify(`behavior-requested-flow-${route}`),
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
  const inferred = inferRequestedApiRequest(request.raw);
  if (!inferred) return [];
  return [
    fileProposal(
      "api",
      `vp/api/${slugify(`requested-${inferred.method.toLowerCase()}-${inferred.path}`)}.yml`,
      {
        id: slugify(`api-requested-${inferred.method.toLowerCase()}-${inferred.path}`),
        title: `${inferred.method} ${inferred.path} responds successfully`,
        severity: "warn",
        app: { kind: "api", base_url: "http://localhost:3000" },
        request: { method: inferred.method, path: inferred.path },
        assert: [
          { status: 200 },
          { header_matches: { name: "content-type", matches: "json" } },
        ],
      },
      inferred.confidence,
      inferred.reason,
    ),
  ];
}

function requestDbProposals(map, request) {
  if (map.coverage.current.database > 0 || !request.inferred_types.includes("database") || map.detected.db_tables.length > 0) return [];
  const engine = inferRequestedDbEngine(request.raw);
  if (engine !== "sqlite") return [];
  return [
    fileProposal(
      "database",
      "vp/db/requested-sqlite-smoke.yml",
      {
        id: "db-requested-sqlite-smoke",
        title: "SQLite schema is queryable",
        severity: "warn",
        app: { kind: "db", engine: "sqlite", connection: "./test.db" },
        query: "SELECT name FROM sqlite_master WHERE type='table'",
        assert: [{ row_count_gte: 0 }],
      },
      "medium",
      "The request explicitly mentions SQLite, so a lightweight schema query is a reasonable starter.",
    ),
  ];
}

function requestPerformanceProposals(map, request) {
  if (map.coverage.current.performance > 0 || !request.inferred_types.includes("performance") || map.detected.ui_routes.length > 0 || map.detected.api_endpoints.length > 0) return [];
  const inferredApi = request.inferred_types.includes("api") ? inferRequestedApiRequest(request.raw) : null;
  const route = inferRequestedUiRoute(request.raw);
  const endpoint = inferredApi?.path || route || "/";
  return [
    fileProposal(
      "performance",
      `vp/nfr/${slugify(`requested-smoke-${endpoint}`)}.yml`,
      {
        id: slugify(`performance-requested-smoke-${endpoint}`),
        title: `${endpoint} meets smoke performance budget`,
        severity: "warn",
        app: { kind: "nfr", base_url: "http://localhost:3000" },
        scenario: {
          endpoint,
          method: inferredApi?.method || "GET",
          thresholds: {
            http_req_duration_p95: 500,
            http_req_failed: 0.05,
          },
          vus: 10,
          duration: "15s",
        },
      },
      endpoint !== "/" ? "medium" : "low",
      `The request asks for performance coverage, and ${endpoint} is the best available starter target.`,
    ),
  ];
}

function requestSecurityProposals(map, request) {
  if (map.coverage.current.security > 0 || !request.inferred_types.includes("security") || (map.detected.auth_signals + map.detected.security_signals) > 0) return [];
  const text = request.raw.toLowerCase();
  if (!/\b(admin|role|permission|protected|authz|authorization)\b/.test(text) && !extractRequestedPaths(request.raw).some(item => item.startsWith("/api/"))) {
    return [];
  }
  const inferredApi = inferRequestedApiRequest(request.raw);
  const protectedPath = inferredApi?.path || "/api/admin";
  return [
    fileProposal(
      "security",
      `vp/security/${slugify(`requested-protection-${protectedPath}`)}.yml`,
      {
        id: slugify(`security-requested-protection-${protectedPath}`),
        title: `${protectedPath} rejects unauthenticated access`,
        severity: "blocker",
        app: { kind: "security", base_url: "http://localhost:3000" },
        request: { method: "GET", path: protectedPath },
        assert: [
          { status: 401 },
          { body_not_contains: "stack trace" },
        ],
      },
      protectedPath !== "/api/health" ? "medium" : "low",
      `The request suggests a protected API surface at ${protectedPath}.`,
    ),
  ];
}

function requestTechnicalProposals(map, request) {
  if (map.coverage.current.technical > 0 || !request.inferred_types.includes("technical")) return [];
  const { frameworkAssertions, deliveryAssertions } = buildRequestTechnicalAssertions(request.raw);
  const proposals = [];

  if (frameworkAssertions.length > 0) {
    proposals.push(fileProposal(
      "technical",
      "vp/technical/requested-framework-stack.yml",
      {
        id: "technical-requested-framework-stack",
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

  if (deliveryAssertions.length > 0) {
    proposals.push(fileProposal(
      "technical",
      "vp/technical/requested-delivery-stack.yml",
      {
        id: "technical-requested-delivery-stack",
        title: "Requested CI and infrastructure constraints stay in place",
        severity: "blocker",
        category: "ci",
        runner: { kind: "custom", framework: "custom" },
        app: { kind: "technical", root: "." },
        assert: deliveryAssertions,
      },
      "medium",
      "The request names concrete CI or infrastructure constraints that can be checked directly.",
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
    ...(technical.length === 0 ? requestTechnicalProposals(map, requestContext) : []),
  ];

  return {
    map,
    lint,
    request: requestContext,
    proposals,
    summary: {
      current_errors: lint.summary.errors,
      current_warnings: lint.summary.warnings,
      proposed_files: proposals.length,
      high_confidence: proposals.filter(p => p.confidence === "high").length,
      medium_confidence: proposals.filter(p => p.confidence === "medium").length,
      low_confidence: proposals.filter(p => p.confidence === "low").length,
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

function extractJsonBlock(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

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
  const providerOptions = aiProvider === "command"
    ? { command: config.draft?.command || config.impl?.command || null }
    : {};
  return { config, provider, aiProvider, model, providerOptions };
}

export function buildDraftPrompt(result) {
  const lines = [];
  lines.push("You are refining a ShipFlow verification drafting workflow.");
  lines.push("Use the local repo map, current lint state, and starter proposals.");
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
  lines.push("Local starter proposals:");
  lines.push(JSON.stringify(result.proposals, null, 2));
  return lines.join("\n");
}

export function parseAiDraftResponse(text) {
  const raw = extractJsonBlock(text);
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

function validateProposals(cwd, proposals) {
  if (proposals.length === 0) {
    return {
      proposals,
      summary: { valid: 0, invalid: 0, blocked_existing: 0 },
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
      let writable = pathCheck.ok && !existing;

      if (existing) {
        issues.push(buildValidationIssue("warn", "draft.path_exists", "Starter path already exists; ShipFlow will not overwrite it."));
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
      return {
        ...proposal,
        validation: {
          ok: !hasError,
          writable: current.writable && !hasError,
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
      },
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
  });
  const aiResult = parseAiDraftResponse(text);
  return mergeDraftResults(localResult, aiResult, options);
}

function writeProposals(cwd, proposals) {
  const created = [];
  for (const proposal of proposals) {
    const full = path.join(cwd, proposal.path);
    if (fs.existsSync(full)) continue;
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
  lines.push(`Requested scope: ${result.request?.raw || "(none)"}`);
  lines.push(`Requested verification types: ${result.request?.inferred_types?.join(", ") || "(none inferred)"}`);
  lines.push("");
  lines.push("What the system understood:");
  lines.push(`  UI routes: ${result.map.detected.ui_routes.slice(0, 5).join(", ") || "(none)"}`);
  lines.push(`  API endpoints: ${result.map.detected.api_endpoints.slice(0, 5).join(", ") || "(none)"}`);
  lines.push(`  Database tables: ${result.map.detected.db_tables.slice(0, 5).join(", ") || "(none)"}`);
  lines.push(`  Technical files: ${result.map.detected.technical_files.slice(0, 5).join(", ") || "(none)"}`);
  lines.push("");
  lines.push("Coverage gaps:");
  const gaps = [...new Set([...(result.map.coverage.gaps || []), ...(result.request?.gaps || [])])];
  if (gaps.length === 0) lines.push("  (none detected)");
  else for (const gap of gaps) lines.push(`  - ${gap}`);
  lines.push("");
  lines.push("Ambiguities:");
  if (result.ambiguities.length === 0) lines.push("  (none detected)");
  else for (const item of result.ambiguities) lines.push(`  - ${item}`);
  lines.push("");
  lines.push("Proposed verification starters:");
  if (result.proposals.length === 0) lines.push("  (no proposal)");
  else {
    for (const proposal of result.proposals) {
      const status = proposal.validation?.ok === false
        ? " [invalid]"
        : proposal.validation?.writable === false
          ? " [exists]"
          : "";
      lines.push(`  - [${proposal.confidence}] ${proposal.path}${status} — ${proposal.reason}${proposal.source === "ai" ? " (AI)" : ""}`);
    }
  }
  if (result.proposal_validation) {
    lines.push("");
    lines.push("Starter validation:");
    lines.push(`  Valid: ${result.proposal_validation.valid}`);
    lines.push(`  Invalid: ${result.proposal_validation.invalid}`);
    lines.push(`  Existing paths kept: ${result.proposal_validation.blocked_existing}`);
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
  if (writeMode) {
    lines.push("");
    lines.push(`Written files: ${result.written.length ? result.written.join(", ") : "(none)"}`);
  } else {
    lines.push("");
    lines.push("Run `shipflow draft \"<user request>\" --write` to write starter files into `vp/`.");
  }
  return lines.join("\n");
}

export async function draft({ cwd, input = "", json = false, write = false, provider, model, ai = false, generateText }) {
  const local = buildDraft(cwd, input);
  const draftOptions = resolveDraftOptions(cwd, { provider, model });
  const effectiveOptions = ai && draftOptions.provider === "local"
    ? { ...draftOptions, provider: draftOptions.aiProvider }
    : draftOptions;
  const result = ai || draftOptions.provider !== "local"
    ? await maybeEnhanceDraft(cwd, local, effectiveOptions, generateText)
    : await maybeEnhanceDraft(cwd, local, draftOptions, generateText);
  const validated = validateProposals(cwd, result.proposals);
  const written = write
    ? writeProposals(cwd, validated.proposals.filter(proposal => proposal.confidence !== "low" && proposal.validation?.writable))
    : [];
  const full = {
    ...result,
    proposals: validated.proposals,
    proposal_validation: validated.summary,
    written,
  };
  if (json) {
    console.log(JSON.stringify(full, null, 2));
  } else {
    console.log(formatHuman(full, write));
  }
  return { exitCode: 0, result: full };
}
