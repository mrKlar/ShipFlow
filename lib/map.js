import fs from "node:fs";
import path from "node:path";
import { readConfig } from "./config.js";

const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".html", ".vue", ".svelte", ".py", ".go", ".rb",
  ".php", ".java", ".kt", ".cs", ".sql",
]);

const EXCLUDED_DIRS = new Set([
  ".git", "node_modules", ".gen", "evidence", "vp", "dist", "coverage",
]);

const TECHNICAL_MARKERS = [
  ".github/workflows",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "infra",
  "terraform",
  "k8s",
  "helm",
  "pulumi",
  "vercel.json",
  "netlify.toml",
  "playwright.config",
  "browserstack",
  "saucelabs",
  "percy",
  "detox",
  "maestro",
  ".lighthouserc",
];

const GRAPHQL_SERVER_PATTERNS = [
  /@apollo\/server/i,
  /apollo-server/i,
  /graphql-yoga/i,
  /mercurius/i,
  /type-graphql/i,
  /graphqlHTTP/i,
  /ApolloServer\b/,
  /createYoga\b/,
  /buildSchema\b/,
  /makeExecutableSchema\b/,
  /GraphQLSchema\b/,
  /typeDefs\b/,
];

const GRAPHQL_SERVER_PACKAGES = new Set([
  "@apollo/server",
  "apollo-server",
  "graphql-yoga",
  "mercurius",
  "type-graphql",
  "express-graphql",
]);

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function listCodeFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      listCodeFiles(full, out);
      continue;
    }
    if (CODE_EXTENSIONS.has(path.extname(ent.name))) out.push(full);
  }
  return out;
}

function countYaml(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml")).length;
}

function uniq(items) {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

function pushMatches(out, regex, content, mapFn = m => m[0]) {
  for (const match of content.matchAll(regex)) out.push(mapFn(match));
}

function relative(cwd, p) {
  return path.relative(cwd, p).replaceAll("\\", "/");
}

function normalizeRoutePath(value) {
  const normalized = `/${String(value || "").trim().replace(/^\/+/, "")}`.replace(/\/+/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function routePathFromFile(relPath) {
  const normalized = String(relPath || "").replaceAll("\\", "/");
  let match = normalized.match(/(?:^|\/)app\/api\/(.+)\/route\.[^.]+$/);
  if (match) {
    const segment = match[1].replace(/\/index$/i, "").replace(/\[\.\.\.[^\]]+\]/g, "*");
    return normalizeRoutePath(`/api/${segment}`);
  }
  match = normalized.match(/(?:^|\/)pages\/api\/(.+)\.[^.]+$/);
  if (match) {
    const segment = match[1].replace(/\/index$/i, "").replace(/\[\.\.\.[^\]]+\]/g, "*");
    return normalizeRoutePath(`/api/${segment}`);
  }
  return null;
}

function uiRouteFromFile(relPath) {
  const normalized = String(relPath || "").replaceAll("\\", "/");
  let match = normalized.match(/(?:^|\/)(?:src\/)?app\/(.+)\/page\.[^.]+$/);
  if (match) {
    const segment = match[1]
      .replace(/\/index$/i, "")
      .split("/")
      .filter(part => part && !/^\(.*\)$/.test(part))
      .join("/");
    return normalizeRoutePath(segment || "/");
  }
  if (/(?:^|\/)(?:src\/)?app\/page\.[^.]+$/.test(normalized)) return "/";

  match = normalized.match(/(?:^|\/)(?:src\/)?pages\/(.+)\.[^.]+$/);
  if (match) {
    const segment = match[1]
      .replace(/^index$/i, "")
      .replace(/\/index$/i, "")
      .replace(/^\//, "");
    if (!segment || segment.startsWith("api/")) return segment ? null : "/";
    return normalizeRoutePath(segment);
  }
  return null;
}

function detectRoutes(content, relPath = "") {
  const routes = [];
  const fileLooksLikeApiHandler = /\b(?:res|reply)\.json\s*\(|\bResponse\.json\s*\(|\bNextResponse\.json\s*\(|\bc\.json\s*\(|\bapplication\/json\b|\bctx\.body\s*=/.test(content);
  pushMatches(routes, /href\s*=\s*["'`]([^"'`?#]+)["'`]/g, content, m => m[1]);
  pushMatches(routes, /\b(?:navigate|router\.push|router\.replace|redirect|page\.goto)\(\s*["'`]([^"'`?#]+)["'`]/g, content, m => m[1]);
  if (!fileLooksLikeApiHandler) {
    pushMatches(routes, /\b(?:app|router|server|fastify)\.(?:get|all)\(\s*["'`]([^"'`]+)["'`]/gi, content, m => m[1]);
  }
  const fileRoute = uiRouteFromFile(relPath);
  if (fileRoute) routes.push(fileRoute);
  return routes.filter(r => r.startsWith("/") && !r.startsWith("/api/"));
}

function detectApiEndpoints(content, relPath = "") {
  const endpoints = [];
  const fileLooksLikeApiHandler = /\b(?:res|reply)\.json\s*\(|\bResponse\.json\s*\(|\bNextResponse\.json\s*\(|\bc\.json\s*\(|\bapplication\/json\b|\bctx\.body\s*=/.test(content);
  pushMatches(endpoints, /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi, content, m => `${m[1].toUpperCase()} ${m[2]}`);
  pushMatches(endpoints, /\bfetch\(\s*["'`]([^"'`]+)["'`]/g, content, m => `FETCH ${m[1]}`);
  pushMatches(endpoints, /\baxios\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi, content, m => `${m[1].toUpperCase()} ${m[2]}`);
  const nextRoute = routePathFromFile(relPath);
  if (nextRoute) {
    const methods = [...content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)]
      .map(match => match[1].toUpperCase());
    if (methods.length === 0) endpoints.push(`ANY ${nextRoute}`);
    else for (const method of [...new Set(methods)]) endpoints.push(`${method} ${nextRoute}`);
  }
  return endpoints.filter(endpoint => {
    const pathMatch = String(endpoint).match(/^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|ANY|FETCH)\s+(.+)$/);
    const routePath = pathMatch ? normalizeRoutePath(pathMatch[1]) : "";
    return routePath.startsWith("/api/")
      || /(?:^|\/)graphql(?:\/|$)/i.test(routePath)
      || (fileLooksLikeApiHandler && routePath.startsWith("/"));
  });
}

function hasGraphqlServerIndicators(content) {
  return GRAPHQL_SERVER_PATTERNS.some(pattern => pattern.test(content));
}

function detectGraphqlEndpoints(content, relPath = "") {
  const endpoints = [];
  const nextRoute = routePathFromFile(relPath);
  if (nextRoute && /graphql/i.test(nextRoute)) endpoints.push(nextRoute);
  pushMatches(endpoints, /["'`](\/(?:api\/)?graphql[^"'`?#\s]*)["'`]/gi, content, m => normalizeRoutePath(m[1]));
  return uniq(endpoints.filter(endpoint => /graphql/i.test(endpoint)));
}

function parseEndpointPath(endpoint) {
  const match = String(endpoint || "").match(/^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|ANY|FETCH)\s+(.+)$/);
  return match ? normalizeRoutePath(match[1]) : null;
}

function isGraphqlPath(routePath) {
  return /(?:^|\/)graphql(?:\/|$)/i.test(String(routePath || ""));
}

function detectExternalApiCalls(content) {
  const calls = [];
  pushMatches(calls, /\bfetch\(\s*["'`](https?:\/\/[^"'`?#\s]+(?:\/[^"'`?#\s]*)?)["'`]/gi, content, m => `FETCH ${m[1]}`);
  pushMatches(calls, /\baxios\.(get|post|put|patch|delete)\(\s*["'`](https?:\/\/[^"'`?#\s]+(?:\/[^"'`?#\s]*)?)["'`]/gi, content, m => `${m[1].toUpperCase()} ${m[2]}`);
  pushMatches(calls, /\b(?:got|superagent)\.(get|post|put|patch|delete)\(\s*["'`](https?:\/\/[^"'`?#\s]+(?:\/[^"'`?#\s]*)?)["'`]/gi, content, m => `${m[1].toUpperCase()} ${m[2]}`);
  return calls;
}

function hostFromExternalApiCall(call) {
  const match = String(call || "").match(/^(?:GET|POST|PUT|PATCH|DELETE|FETCH)\s+(https?:\/\/.+)$/i);
  if (!match) return null;
  try {
    return new URL(match[1]).host;
  } catch {
    return null;
  }
}

function detectTables(content) {
  const tables = [];
  pushMatches(tables, /\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+["'`]?([a-zA-Z0-9_]+)["'`]?/gi, content, m => m[1]);
  pushMatches(tables, /\bSELECT\b[\s\S]{0,160}?\bFROM\s+["'`]?([a-zA-Z0-9_]+)["'`]?/gi, content, m => m[1]);
  pushMatches(tables, /\bINSERT\s+INTO\s+["'`]?([a-zA-Z0-9_]+)["'`]?/gi, content, m => m[1]);
  pushMatches(tables, /\bDELETE\s+FROM\s+["'`]?([a-zA-Z0-9_]+)["'`]?/gi, content, m => m[1]);
  pushMatches(tables, /\bUPDATE\s+["'`]?([a-zA-Z0-9_]+)["'`]?\s+SET\b/gi, content, m => m[1]);
  return tables;
}

function countSignals(content, patterns) {
  return patterns.reduce((total, pattern) => total + (content.match(pattern)?.length || 0), 0);
}

function detectTechnicalFiles(cwd) {
  const found = [];
  for (const marker of TECHNICAL_MARKERS) {
    if (fs.existsSync(path.join(cwd, marker))) found.push(marker);
  }
  return found;
}

function uniqStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function uniqRecommendations(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = `${item.type}::${item.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function recommendedFrameworks() {
  return {
    ui: ["playwright"],
    behavior: ["cucumber", "playwright-browser", "playwright-api", "pty-harness"],
    domain: ["business-domain-contract-runner"],
    api: ["playwright-api", "pactum"],
    database: ["sql-harness", "pgtap"],
    performance: ["k6"],
    security: ["playwright-api", "owasp-zap"],
    technical: ["repo-backend", "dependency-cruiser", "tsarch", "madge", "eslint-plugin-boundaries"],
  };
}

const VERIFICATION_TYPE_ORDER = ["ui", "behavior", "domain", "api", "database", "performance", "security", "technical"];

export const APP_ARCHETYPE_BUNDLES = Object.freeze({
  "frontend-web": {
    label: "frontend web",
    required_types: ["ui", "behavior", "technical"],
    advisory_types: ["performance"],
  },
  "fullstack-web-stateless": {
    label: "fullstack web (stateless)",
    required_types: ["ui", "behavior", "api", "technical"],
    advisory_types: ["security", "performance"],
  },
  "fullstack-web-stateful": {
    label: "fullstack web (stateful)",
    required_types: ["ui", "behavior", "domain", "api", "database", "technical"],
    advisory_types: ["security", "performance"],
  },
  "api-service-stateless": {
    label: "API service (stateless)",
    required_types: ["behavior", "api", "technical"],
    advisory_types: ["security", "performance"],
  },
  "api-service-stateful": {
    label: "API service (stateful)",
    required_types: ["behavior", "domain", "api", "database", "technical"],
    advisory_types: ["security", "performance"],
  },
  "rest-service": {
    label: "REST backend service",
    required_types: ["behavior", "domain", "api", "technical"],
    advisory_types: ["security", "performance"],
  },
  "cli-tui-stateless": {
    label: "CLI/TUI (stateless)",
    required_types: ["behavior", "technical"],
    advisory_types: [],
  },
  "cli-tui-stateful": {
    label: "CLI/TUI (stateful)",
    required_types: ["behavior", "domain", "database", "technical"],
    advisory_types: [],
  },
});

function sortVerificationTypes(types) {
  return [...new Set((types || []).filter(Boolean))].sort((a, b) => {
    const left = VERIFICATION_TYPE_ORDER.indexOf(a);
    const right = VERIFICATION_TYPE_ORDER.indexOf(b);
    return (left === -1 ? VERIFICATION_TYPE_ORDER.length : left) - (right === -1 ? VERIFICATION_TYPE_ORDER.length : right);
  });
}

function archetypeSignalFlags(detected = {}, request = "") {
  const text = String(request || "").toLowerCase();
  return {
    hasWeb: (detected.ui_routes?.length || 0) > 0
      || /\b(web|browser|ui|frontend|front-end|screen|page|dashboard|form)\b/.test(text),
    hasApi: (detected.api_endpoints?.length || 0) > 0
      || /\b(api|endpoint|rest|graphql|json|backend|server|service|webhook)\b/.test(text),
    hasTui: (detected.tui_signals || 0) > 0
      || /\b(cli|terminal|tui|console|command line|shell)\b/.test(text),
    hasDatabase: (detected.db_tables?.length || 0) > 0
      || /\b(sqlite|postgres|postgresql|mysql|database|db|storage|persist|history|saved|mongo|prisma|drizzle)\b/.test(text),
    hasRest: Boolean(detected.protocols?.rest?.detected)
      || (/\brest\b/.test(text) && !/\bgraphql\b/.test(text)),
    hasGraphql: Boolean(detected.protocols?.graphql?.detected)
      || /\bgraphql\b/.test(text),
    hasUpstreamApis: (detected.external_api_calls?.length || 0) > 0
      || /\b(multiple api|multiple apis|multiple external api|multiple external apis|third-party api|third party api|upstream api|upstream apis|partner api|partner apis|aggregat(?:e|or)|orchestr(?:ate|ation)|fan-?out|integrat(?:e|es|ion)s?)\b/.test(text),
  };
}

export function inferAppArchetype({ detected = {}, request = "" } = {}) {
  const { hasWeb, hasApi, hasTui, hasDatabase, hasRest, hasGraphql } = archetypeSignalFlags(detected, request);

  if (hasWeb && hasApi) return hasDatabase ? "fullstack-web-stateful" : "fullstack-web-stateless";
  if (hasWeb && !hasApi && !hasTui) return "frontend-web";
  if (hasApi && !hasWeb && !hasTui) {
    if (hasRest && !hasGraphql) return "rest-service";
    return hasDatabase ? "api-service-stateful" : "api-service-stateless";
  }
  if (hasTui && !hasWeb) return hasDatabase ? "cli-tui-stateful" : "cli-tui-stateless";
  return null;
}

export function bundleForAppArchetype(archetype, { detected = {}, request = "" } = {}) {
  if (!archetype) return null;
  const bundle = APP_ARCHETYPE_BUNDLES[archetype];
  if (!bundle) return null;
  const { hasDatabase, hasUpstreamApis } = archetypeSignalFlags(detected, request);
  const traits = [];
  let requiredTypes = bundle.required_types;
  if (archetype === "rest-service") {
    if (hasDatabase) requiredTypes = [...requiredTypes, "database"];
    if (hasDatabase) traits.push("stateful");
    if (hasUpstreamApis) traits.push("integration");
  }
  return {
    archetype,
    label: traits.length > 0 ? `${bundle.label} (${traits.join(", ")})` : bundle.label,
    required_types: sortVerificationTypes(requiredTypes),
    advisory_types: sortVerificationTypes(bundle.advisory_types),
  };
}

function missingBundleTypes(coverage = {}, types = []) {
  return sortVerificationTypes(types.filter(type => Number(coverage?.[type] || 0) === 0));
}

function archetypeRecommendationSummary(type, detected = {}) {
  switch (type) {
    case "ui":
      return detected.ui_routes?.length
        ? `Add UI checks for the primary visible routes: ${detected.ui_routes.slice(0, 3).join(", ")}.`
        : "Add UI checks for the primary user-visible route and outcome.";
    case "behavior":
      return "Add end-to-end behavior checks for the core flow, with at least one failure path.";
    case "api":
      if ((detected.external_api_hosts?.length || 0) > 1) {
        return `Add API contract checks for the public REST surface and upstream failure handling across ${detected.external_api_hosts.slice(0, 3).join(", ")}.`;
      }
      return detected.api_endpoints?.length
        ? `Add API contract checks for the same critical operations: ${detected.api_endpoints.slice(0, 3).join(", ")}.`
        : "Add API contract checks for the critical operations behind the core flow.";
    case "database":
      return detected.db_tables?.length
        ? `Add database before/after invariants for persisted state in: ${detected.db_tables.slice(0, 3).join(", ")}.`
        : "Add database state checks for the persisted records touched by the core flow.";
    case "domain":
      return detected.db_tables?.length
        ? `Define the business-domain objects behind persisted state in ${detected.db_tables.slice(0, 3).join(", ")}, including identities, references, invariants, access patterns, and the data-engineering step.`
        : "Define the core business-domain objects, identities, references, invariants, access patterns, and the data-engineering step.";
    case "technical":
      if ((detected.external_api_hosts?.length || 0) > 0) {
        return `Add technical runtime and dependency checks so the service, database driver, and upstream API clients really load.`;
      }
      return "Add technical runtime and dependency checks so the backend stack and native integrations really load.";
    case "performance":
      return "Add a smoke performance budget for the primary page or endpoint.";
    case "security":
      return "Add security checks for unauthenticated access, authz failure, and required headers.";
    default:
      return "Add the missing verification coverage for this app archetype.";
  }
}

function buildArchetypeAssessment({ detected = {}, coverage = {}, request = "" } = {}) {
  const appArchetype = inferAppArchetype({ detected, request });
  const bundle = bundleForAppArchetype(appArchetype, { detected, request });
  if (!bundle) {
    return {
      app_archetype: null,
      verification_bundle: null,
      gaps: [],
      recommendations: [],
    };
  }

  const missingRequiredTypes = missingBundleTypes(coverage, bundle.required_types);
  const gaps = missingRequiredTypes.length > 0
    ? [`This looks like a ${bundle.label} app, but the pack is missing the baseline bundle: ${missingRequiredTypes.join(", ")}.`]
    : [];
  const recommendations = missingRequiredTypes.map(type => ({
    type,
    summary: archetypeRecommendationSummary(type, detected),
  }));

  return {
    app_archetype: appArchetype,
    verification_bundle: {
      label: bundle.label,
      required_types: bundle.required_types,
      advisory_types: bundle.advisory_types,
      missing_required_types: missingRequiredTypes,
    },
    gaps,
    recommendations,
  };
}

export function detectRequestedTypes(input) {
  const text = String(input || "").toLowerCase();
  if (!text) return [];
  const types = new Set(["behavior"]);
  const hasTuiHint = /\b(cli|terminal|tui|console|command line|shell)\b/.test(text);
  if (/\b(ui|ux|page|screen|form|button|modal|dashboard|web)\b/.test(text) || (!hasTuiHint && /\b(todo|task)\b/.test(text))) {
    types.add("ui");
  }
  if (/\b(api|endpoint|rest|graphql|json|backend|server|webhook)\b/.test(text)) types.add("api");
  if (/\b(db|database|postgres|postgresql|mysql|sqlite|sql|prisma|drizzle|mongo)\b/.test(text)) types.add("database");
  if (/\b(domain|domain model|domain object|business object|entity|entities|aggregate|bounded context|ddd|read model|write model|data model|data engineering)\b/.test(text)) types.add("domain");
  if (/\b(load|perf|performance|latency|throughput|scale|stress)\b/.test(text)) types.add("performance");
  if (/\b(auth|login|signin|signup|password|session|jwt|token|role|admin|permission|cors|csrf|security)\b/.test(text)) types.add("security");
  if (/\b(next|react|vue|angular|svelte|express|fastify|nest|graphql|apollo|urql|relay|rest|architecture|layer|docker|kubernetes|terraform|github actions|browserstack|sauce|detox|maestro|tsarch|dependency-cruiser|ci|infra|infrastructure|cross-browser|browser testing|real devices|mobile devices|visual regression|testing saas|testing platform|cloud testing|sqlite|postgres|postgresql|mysql|prisma|drizzle|mongo)\b/.test(text)) {
    types.add("technical");
  }
  return [...types];
}

function detectBehaviorSurfaces(input) {
  const text = String(input || "").toLowerCase();
  const surfaces = new Set();
  if (/\b(ui|ux|page|screen|form|button|modal|dashboard|web)\b/.test(text)) surfaces.add("web");
  if (/\b(api|endpoint|rest|graphql|json|backend|server|webhook)\b/.test(text)) surfaces.add("api");
  if (/\b(cli|terminal|tui|console|command line|shell)\b/.test(text)) surfaces.add("tui");
  return [...surfaces];
}

export function buildRequestContext(request, result) {
  const raw = String(request || "").trim();
  const inferred_types = detectRequestedTypes(raw);
  const gaps = [];
  const ambiguities = [];
  const recommendations = [];

  if (!raw) {
    return { raw, inferred_types, gaps, ambiguities, recommendations };
  }

  const coverage = result.coverage?.current || {};
  const detected = result.detected || {};
  const archetypeAssessment = buildArchetypeAssessment({ detected, coverage, request: raw });
  const repoHasTechnicalSignals = (detected.technical_files?.length || 0) > 0;
  const repoHasSurface = (detected.ui_routes?.length || 0) > 0 || (detected.api_endpoints?.length || 0) > 0;
  const requestedBehaviorSurfaces = detectBehaviorSurfaces(raw);

  const requestRecommendations = {
    behavior: "Add requested user scenarios with a happy path and at least one failure path.",
    domain: "Define the business objects, identities, references, invariants, access patterns, and the data-engineering translation into read/write and exchange models.",
    ui: "Clarify the requested screens, selectors, and expected visible states.",
    api: "Clarify the requested endpoints, auth requirements, statuses, headers, and JSON contracts.",
    database: "Clarify the engine, tables, seed state, and before/after invariants for the requested database scope.",
    performance: "Set a smoke load profile plus explicit latency and error budgets for the requested performance scope.",
    security: "Clarify authn/authz rejection semantics, required headers, and exposure constraints for the requested security scope.",
    technical: "Clarify framework, architecture, CI, infrastructure, and required SaaS/tooling constraints for the requested technical scope.",
  };

  for (const type of inferred_types) {
    if ((coverage[type] || 0) === 0) {
      gaps.push(`The request points to ${type} coverage, but the current verification pack has no ${type} checks yet.`);
      recommendations.push({ type, summary: requestRecommendations[type] });
    }
  }

  gaps.push(...archetypeAssessment.gaps);
  const requestedSet = new Set(inferred_types);
  for (const recommendation of archetypeAssessment.recommendations) {
    if (requestedSet.has(recommendation.type)) continue;
    recommendations.push(recommendation);
  }

  if (inferred_types.includes("behavior") && !repoHasSurface) {
    ambiguities.push("The request mentions user flows, but the repo scan did not reveal concrete screens or endpoints yet.");
  }
  if (requestedBehaviorSurfaces.includes("tui") && (detected.tui_signals || 0) === 0) {
    ambiguities.push("The request mentions CLI or TUI behavior, but the repo scan did not reveal a concrete terminal entrypoint yet.");
  }
  if (inferred_types.includes("ui") && (detected.ui_routes?.length || 0) === 0) {
    ambiguities.push("The request mentions UI behavior, but no concrete routes were detected yet.");
  }
  if (inferred_types.includes("api") && (detected.api_endpoints?.length || 0) === 0) {
    ambiguities.push("The request mentions API behavior, but no concrete endpoint was detected yet.");
  }
  if (inferred_types.includes("database") && (detected.db_tables?.length || 0) === 0) {
    ambiguities.push("The request mentions database behavior, but no concrete table or connection details were detected yet.");
  }
  if (inferred_types.includes("performance") && !repoHasSurface) {
    ambiguities.push("The request mentions performance or load behavior, but no primary page or endpoint was detected yet.");
  }
  if (inferred_types.includes("security") && ((detected.auth_signals || 0) + (detected.security_signals || 0)) === 0) {
    ambiguities.push("The request mentions auth or security behavior, but the repo scan did not reveal concrete security surfaces yet.");
  }
  if (inferred_types.includes("technical") && !repoHasTechnicalSignals) {
    ambiguities.push("The request mentions technical constraints, but the repo scan did not reveal concrete framework, CI, or infrastructure markers yet.");
  }

  return {
    raw,
    inferred_types,
    app_archetype: archetypeAssessment.app_archetype,
    verification_bundle: archetypeAssessment.verification_bundle,
    gaps: uniqStrings(gaps),
    ambiguities,
    recommendations,
  };
}

function formatHuman(result) {
  const labels = {
    ui: "UI",
    behavior: "Behavior",
    domain: "Business Domain",
    api: "API",
    database: "Database",
    performance: "Performance",
    security: "Security",
    technical: "Technical",
  };
  const lines = [];
  lines.push("ShipFlow Map");
  lines.push("");
  if (result.request?.raw) {
    lines.push(`Requested scope: ${result.request.raw}`);
    lines.push(`Requested verification types: ${result.request.inferred_types.join(", ") || "(none inferred)"}`);
    lines.push(`Requested app archetype: ${result.request.app_archetype || "(none inferred)"}`);
    if (result.request.verification_bundle?.required_types?.length) {
      lines.push(`Requested baseline bundle: ${result.request.verification_bundle.required_types.join(", ")}`);
    }
    lines.push("");
  }
  lines.push(`Project: ${result.project.name}`);
  lines.push(`Source roots: ${result.project.source_roots.join(", ") || "(none detected)"}`);
  lines.push(`App archetype: ${result.project.app_archetype || "(none inferred)"}`);
  if (result.project.verification_bundle?.required_types?.length) {
    lines.push(`Baseline bundle: ${result.project.verification_bundle.required_types.join(", ")}`);
  }
  lines.push("");
  lines.push("Current Verification Pack coverage:");
  for (const [type, count] of Object.entries(result.coverage.current)) {
    lines.push(`  ${labels[type] || type}: ${count}`);
  }
  lines.push("");
  lines.push("Detected surfaces:");
  lines.push(`  UI routes: ${result.detected.ui_routes.slice(0, 8).join(", ") || "(none)"}`);
  lines.push(`  API endpoints: ${result.detected.api_endpoints.slice(0, 8).join(", ") || "(none)"}`);
  lines.push(`  Database tables: ${result.detected.db_tables.slice(0, 8).join(", ") || "(none)"}`);
  lines.push(`  External API calls: ${result.detected.external_api_calls.slice(0, 8).join(", ") || "(none)"}`);
  lines.push(`  External API hosts: ${result.detected.external_api_hosts.slice(0, 8).join(", ") || "(none)"}`);
  lines.push(`  Auth signals: ${result.detected.auth_signals}`);
  lines.push(`  Security signals: ${result.detected.security_signals}`);
  lines.push(`  GraphQL protocol: ${result.detected.protocols?.graphql?.detected ? result.detected.protocols.graphql.endpoints.join(", ") || "detected" : "(none)"}`);
  lines.push(`  REST protocol: ${result.detected.protocols?.rest?.detected ? result.detected.protocols.rest.endpoints.join(", ") || "detected" : "(none)"}`);
  lines.push(`  Technical files: ${result.detected.technical_files.slice(0, 8).join(", ") || "(none)"}`);
  lines.push("");
  lines.push("Coverage gaps:");
  const gaps = uniqStrings([...(result.coverage.gaps || []), ...(result.request?.gaps || [])]);
  if (gaps.length === 0) {
    lines.push("  (none detected)");
  } else {
    for (const gap of gaps) lines.push(`  - ${gap}`);
  }
  lines.push("");
  lines.push("Ambiguities:");
  if ((result.ambiguities || []).length === 0) {
    lines.push("  (none detected)");
  } else {
    for (const item of result.ambiguities) lines.push(`  - ${item}`);
  }
  lines.push("");
  lines.push("Recommended next checks:");
  if (result.recommendations.length === 0) {
    lines.push("  (no automatic recommendation)");
  } else {
    for (const rec of result.recommendations) {
      lines.push(`  - [${labels[rec.type] || rec.type}] ${rec.summary}`);
    }
  }
  lines.push("");
  lines.push("Recommended frameworks:");
  for (const [type, frameworks] of Object.entries(result.framework_recommendations || {})) {
    lines.push(`  ${labels[type] || type}: ${frameworks.join(", ")}`);
  }
  return lines.join("\n");
}

export function buildMap(cwd, request = "") {
  const config = readConfig(cwd);
  const configuredSrcDir = config.impl?.srcDir;
  const rootCandidates = [configuredSrcDir, "src", "app", "pages", "routes", "server", "lib"]
    .filter(Boolean)
    .map(p => path.join(cwd, p))
    .filter((p, idx, arr) => fs.existsSync(p) && arr.indexOf(p) === idx);

  const sourceRoots = rootCandidates.length > 0 ? rootCandidates : [cwd];
  const files = sourceRoots.flatMap(root => listCodeFiles(root));

  const uiRoutes = [];
  const apiEndpoints = [];
  const dbTables = [];
  const externalApiCalls = [];
  let authSignals = 0;
  let securitySignals = 0;
  let tuiSignals = 0;
  const technicalFiles = detectTechnicalFiles(cwd);
  const graphqlSignalFiles = [];
  const graphqlEndpoints = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const relFile = relative(cwd, file);
    uiRoutes.push(...detectRoutes(content, relFile));
    apiEndpoints.push(...detectApiEndpoints(content, relFile));
    dbTables.push(...detectTables(content));
    externalApiCalls.push(...detectExternalApiCalls(content));
    authSignals += countSignals(content, [/\bauth\b/gi, /\blogin\b/gi, /\bpassword\b/gi, /\bjwt\b/gi, /\bsession\b/gi, /\btoken\b/gi]);
    securitySignals += countSignals(content, [/\bcsrf\b/gi, /\bcors\b/gi, /\bhelmet\b/gi, /content-security-policy/gi, /x-frame-options/gi, /rate.?limit/gi]);
    tuiSignals += countSignals(content, [/\bprocess\.stdin\b/g, /\breadline\b/g, /\bcommander\b/g, /\byargs\b/g, /\bink\b/g, /\bblessed\b/g]);
    if (hasGraphqlServerIndicators(content)) graphqlSignalFiles.push(relFile);
    graphqlEndpoints.push(...detectGraphqlEndpoints(content, relFile));
  }

  const packageJson = readJsonIfExists(path.join(cwd, "package.json"));
  const depNames = Object.keys({
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies,
    ...packageJson?.optionalDependencies,
  });
  const graphqlPackages = depNames.filter(name => GRAPHQL_SERVER_PACKAGES.has(name));

  const coverage = {
    current: {
      ui: countYaml(path.join(cwd, "vp", "ui")),
      behavior: countYaml(path.join(cwd, "vp", "behavior")),
      domain: countYaml(path.join(cwd, "vp", "domain")),
      api: countYaml(path.join(cwd, "vp", "api")),
      database: countYaml(path.join(cwd, "vp", "db")),
      performance: countYaml(path.join(cwd, "vp", "nfr")),
      security: countYaml(path.join(cwd, "vp", "security")),
      technical: countYaml(path.join(cwd, "vp", "technical")),
    },
    gaps: [],
  };

  const recommendations = [];
  const ambiguities = [];
  const uniqueRoutes = uniq(uiRoutes);
  const uniqueApis = uniq(apiEndpoints);
  const uniqueTables = uniq(dbTables);
  const uniqueExternalApiCalls = uniq(externalApiCalls);
  const uniqueExternalApiHosts = uniq(uniqueExternalApiCalls.map(hostFromExternalApiCall).filter(Boolean));
  const uniqueGraphqlEndpoints = uniq(graphqlEndpoints);
  const restRoutes = uniq(uniqueApis
    .map(parseEndpointPath)
    .filter(routePath => routePath && !isGraphqlPath(routePath)));
  const graphqlDetected = uniqueGraphqlEndpoints.length > 0 && (graphqlSignalFiles.length > 0 || graphqlPackages.length > 0);
  const restDetected = restRoutes.length > 0;

  if (uniqueRoutes.length > 0 && coverage.current.ui === 0) {
    coverage.gaps.push(`Detected ${uniqueRoutes.length} UI route(s) but no UI verification.`);
    recommendations.push({
      type: "ui",
      summary: `Cover primary routes first: ${uniqueRoutes.slice(0, 3).join(", ")}`,
    });
  }

  if ((uniqueRoutes.length > 0 || uniqueApis.length > 0 || tuiSignals > 0) && coverage.current.behavior === 0) {
    coverage.gaps.push("Detected executable product surfaces but no behavior verification.");
    recommendations.push({
      type: "behavior",
      summary: uniqueRoutes.length > 0
        ? "Add end-to-end user scenarios for the main happy path and at least one failure path."
        : uniqueApis.length > 0
          ? `Add API behavior scenarios for: ${uniqueApis.slice(0, 2).join(", ")}`
          : "Add CLI or TUI behavior scenarios for the main command flow and one failure path.",
    });
  }

  if (uniqueApis.length > 0 && coverage.current.api === 0) {
    coverage.gaps.push(`Detected ${uniqueApis.length} API endpoint(s) but no API verification.`);
    recommendations.push({
      type: "api",
      summary: uniqueExternalApiHosts.length > 1
        ? `Cover request/response contracts for ${uniqueApis.slice(0, 3).join(", ")} and upstream failure handling across ${uniqueExternalApiHosts.slice(0, 3).join(", ")}.`
        : `Cover request/response contracts for: ${uniqueApis.slice(0, 3).join(", ")}`,
    });
  }

  if (uniqueTables.length > 0 && coverage.current.database === 0) {
    coverage.gaps.push(`Detected database usage (${uniqueTables.slice(0, 3).join(", ")}) but no database verification.`);
    recommendations.push({
      type: "database",
      summary: `Verify seed state and critical queries for tables: ${uniqueTables.slice(0, 3).join(", ")}`,
    });
  }

  if ((uniqueTables.length > 0 || uniqueExternalApiHosts.length > 1) && coverage.current.domain === 0) {
    coverage.gaps.push("Detected persisted or integrated business data but no business-domain verification.");
    recommendations.push({
      type: "domain",
      summary: uniqueTables.length > 0
        ? `Define business-domain objects, access patterns, and the data-engineering step for: ${uniqueTables.slice(0, 3).join(", ")}.`
        : `Define the core business-domain objects and integration-facing read/write models for upstream APIs: ${uniqueExternalApiHosts.slice(0, 3).join(", ")}.`,
    });
  }

  if ((uniqueRoutes.length > 0 || uniqueApis.length > 0) && coverage.current.performance === 0) {
    coverage.gaps.push("Detected user/API surface but no performance verification.");
    recommendations.push({
      type: "performance",
      summary: "Add a smoke load budget for the main page or primary API endpoint.",
    });
  }

  if ((authSignals > 0 || securitySignals > 0) && coverage.current.security === 0) {
    coverage.gaps.push("Detected auth/security signals but no security verification.");
    recommendations.push({
      type: "security",
      summary: "Add unauthenticated access, authz failure, and security headers checks.",
    });
  }

  if ((technicalFiles.length > 0 || files.some(file => path.basename(file) === "package.json")) && coverage.current.technical === 0) {
    coverage.gaps.push("Detected technical constraints or delivery tooling but no technical verification.");
    recommendations.push({
      type: "technical",
      summary: uniqueExternalApiHosts.length > 0
        ? "Add checks for framework choices, architecture boundaries, runtime dependencies, upstream API clients, CI workflows, infrastructure files, and required SaaS/test tooling."
        : "Add checks for framework choices, architecture boundaries, CI workflows, infrastructure files, and required SaaS/test tooling.",
    });
  }

  if (coverage.current.technical === 0 && graphqlDetected && !restDetected) {
    recommendations.push({
      type: "technical",
      summary: `Enforce the detected GraphQL surface at ${uniqueGraphqlEndpoints[0]} and prevent stray REST routes.`,
    });
  }

  if (coverage.current.technical === 0 && restDetected && !graphqlDetected) {
    recommendations.push({
      type: "technical",
      summary: `Enforce the detected REST surface under ${restRoutes[0]} and prevent stray GraphQL endpoints.`,
    });
  }

  if (files.length === 0) ambiguities.push("No source files were detected during repo scan.");
  if (uniqueRoutes.length > 0 && coverage.current.ui === 0) ambiguities.push("Static analysis found routes, but not enough UI selector semantics to draft rich UI assertions automatically.");
  if (uniqueApis.length > 0 && coverage.current.api === 0) ambiguities.push("Static analysis found endpoints, but not enough response shape information to infer full API contracts automatically.");
  if (tuiSignals > 0 && coverage.current.behavior === 0) ambiguities.push("Static analysis found CLI/TUI signals, but command arguments and expected terminal output remain ambiguous.");
  if (uniqueTables.length > 0 && coverage.current.database === 0) ambiguities.push("Database tables were detected, but connection details and state invariants remain ambiguous.");
  if ((uniqueTables.length > 0 || uniqueExternalApiHosts.length > 1) && coverage.current.domain === 0) ambiguities.push("Persisted or integrated business data was detected, but the core business-domain objects, references, access patterns, and data-engineering translation are still ambiguous.");
  if (uniqueExternalApiHosts.length > 1 && coverage.current.api === 0) ambiguities.push("Multiple upstream API hosts were detected, but fallback, timeout, and partial-failure semantics remain ambiguous.");
  if ((authSignals > 0 || securitySignals > 0) && coverage.current.security === 0) ambiguities.push("Security-sensitive surfaces were detected, but expected rejection semantics (401/403/redirect/headers) are still ambiguous.");
  if (graphqlSignalFiles.length > 0 && uniqueGraphqlEndpoints.length === 0) ambiguities.push("GraphQL server markers were detected, but no concrete GraphQL endpoint path was found yet.");
  if (graphqlDetected && restDetected) ambiguities.push("Both REST and GraphQL server surfaces were detected, so the intended protocol boundary still needs an explicit technical check.");

  const detected = {
    ui_routes: uniqueRoutes,
    api_endpoints: uniqueApis,
    db_tables: uniqueTables,
    external_api_calls: uniqueExternalApiCalls,
    external_api_hosts: uniqueExternalApiHosts,
    auth_signals: authSignals,
    security_signals: securitySignals,
    tui_signals: tuiSignals,
    technical_files: technicalFiles,
    protocols: {
      graphql: {
        detected: graphqlDetected,
        endpoints: uniqueGraphqlEndpoints,
        files: uniq(graphqlSignalFiles),
        packages: graphqlPackages,
      },
      rest: {
        detected: restDetected,
        endpoints: restRoutes,
        path_prefix: restDetected ? "/api/" : null,
      },
    },
  };
  const projectArchetype = buildArchetypeAssessment({ detected, coverage: coverage.current });
  coverage.gaps.push(...projectArchetype.gaps);
  coverage.gaps = uniqStrings(coverage.gaps);
  const requestContext = buildRequestContext(request, { coverage, detected });

  return {
    project: {
      name: path.basename(cwd),
      source_roots: sourceRoots.map(p => relative(cwd, p) || "."),
      configured_src_dir: configuredSrcDir || null,
      scanned_files: files.length,
      app_archetype: projectArchetype.app_archetype,
      verification_bundle: projectArchetype.verification_bundle,
    },
    coverage,
    detected,
    framework_recommendations: recommendedFrameworks(),
    recommendations: uniqRecommendations([...recommendations, ...projectArchetype.recommendations, ...requestContext.recommendations]),
    ambiguities: uniqStrings([...ambiguities, ...requestContext.ambiguities]),
    request: requestContext,
  };
}

export function map({ cwd, input = "", json = false }) {
  const result = buildMap(cwd, input);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatHuman(result));
  }
  return { exitCode: 0, result };
}
