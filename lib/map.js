import fs from "node:fs";
import path from "node:path";
import { readConfig } from "./impl.js";

const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".html", ".vue", ".svelte", ".py", ".go", ".rb",
  ".php", ".java", ".kt", ".cs", ".sql",
]);

const EXCLUDED_DIRS = new Set([
  ".git", "node_modules", ".gen", "evidence", "vp", "dist", "coverage",
]);

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

function detectRoutes(content) {
  const routes = [];
  pushMatches(routes, /href\s*=\s*["'`]([^"'`?#]+)["'`]/g, content, m => m[1]);
  pushMatches(routes, /\b(?:navigate|router\.push|router\.replace|redirect|page\.goto)\(\s*["'`]([^"'`?#]+)["'`]/g, content, m => m[1]);
  return routes.filter(r => r.startsWith("/") && !r.startsWith("/api/"));
}

function detectApiEndpoints(content) {
  const endpoints = [];
  pushMatches(endpoints, /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi, content, m => `${m[1].toUpperCase()} ${m[2]}`);
  pushMatches(endpoints, /\bfetch\(\s*["'`]([^"'`]+)["'`]/g, content, m => `FETCH ${m[1]}`);
  pushMatches(endpoints, /\baxios\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi, content, m => `${m[1].toUpperCase()} ${m[2]}`);
  return endpoints.filter(e => e.includes("/api/") || e.startsWith("GET ") || e.startsWith("POST ") || e.startsWith("PUT ") || e.startsWith("PATCH ") || e.startsWith("DELETE "));
}

function detectTables(content) {
  const tables = [];
  pushMatches(tables, /\bCREATE\s+TABLE\s+["'`]?([a-zA-Z0-9_]+)["'`]?/gi, content, m => m[1]);
  pushMatches(tables, /\bFROM\s+["'`]?([a-zA-Z0-9_]+)["'`]?/gi, content, m => m[1]);
  pushMatches(tables, /\bINTO\s+["'`]?([a-zA-Z0-9_]+)["'`]?/gi, content, m => m[1]);
  pushMatches(tables, /\bUPDATE\s+["'`]?([a-zA-Z0-9_]+)["'`]?/gi, content, m => m[1]);
  return tables;
}

function countSignals(content, patterns) {
  return patterns.reduce((total, pattern) => total + (content.match(pattern)?.length || 0), 0);
}

function formatHuman(result) {
  const labels = {
    ui: "UI",
    behavior: "Behavior",
    api: "API",
    database: "Database",
    performance: "Performance",
    security: "Security",
  };
  const lines = [];
  lines.push("ShipFlow Map");
  lines.push("");
  lines.push(`Project: ${result.project.name}`);
  lines.push(`Source roots: ${result.project.source_roots.join(", ") || "(none detected)"}`);
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
  lines.push(`  Auth signals: ${result.detected.auth_signals}`);
  lines.push(`  Security signals: ${result.detected.security_signals}`);
  lines.push("");
  lines.push("Coverage gaps:");
  if (result.coverage.gaps.length === 0) {
    lines.push("  (none detected)");
  } else {
    for (const gap of result.coverage.gaps) lines.push(`  - ${gap}`);
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
  return lines.join("\n");
}

export function buildMap(cwd) {
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
  let authSignals = 0;
  let securitySignals = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    uiRoutes.push(...detectRoutes(content));
    apiEndpoints.push(...detectApiEndpoints(content));
    dbTables.push(...detectTables(content));
    authSignals += countSignals(content, [/\bauth\b/gi, /\blogin\b/gi, /\bpassword\b/gi, /\bjwt\b/gi, /\bsession\b/gi, /\btoken\b/gi]);
    securitySignals += countSignals(content, [/\bcsrf\b/gi, /\bcors\b/gi, /\bhelmet\b/gi, /content-security-policy/gi, /x-frame-options/gi, /rate.?limit/gi]);
  }

  const coverage = {
    current: {
      ui: countYaml(path.join(cwd, "vp", "ui")),
      behavior: countYaml(path.join(cwd, "vp", "behavior")),
      api: countYaml(path.join(cwd, "vp", "api")),
      database: countYaml(path.join(cwd, "vp", "db")),
      performance: countYaml(path.join(cwd, "vp", "nfr")),
      security: countYaml(path.join(cwd, "vp", "security")),
    },
    gaps: [],
  };

  const recommendations = [];
  const uniqueRoutes = uniq(uiRoutes);
  const uniqueApis = uniq(apiEndpoints);
  const uniqueTables = uniq(dbTables);

  if (uniqueRoutes.length > 0 && coverage.current.ui === 0) {
    coverage.gaps.push(`Detected ${uniqueRoutes.length} UI route(s) but no UI verification.`);
    recommendations.push({
      type: "ui",
      summary: `Cover primary routes first: ${uniqueRoutes.slice(0, 3).join(", ")}`,
    });
  }

  if (uniqueRoutes.length > 0 && coverage.current.behavior === 0) {
    coverage.gaps.push("Detected navigable UI flows but no behavior/Gherkin verification.");
    recommendations.push({
      type: "behavior",
      summary: "Add end-to-end user scenarios for the main happy path and at least one failure path.",
    });
  }

  if (uniqueApis.length > 0 && coverage.current.api === 0) {
    coverage.gaps.push(`Detected ${uniqueApis.length} API endpoint(s) but no API verification.`);
    recommendations.push({
      type: "api",
      summary: `Cover request/response contracts for: ${uniqueApis.slice(0, 3).join(", ")}`,
    });
  }

  if (uniqueTables.length > 0 && coverage.current.database === 0) {
    coverage.gaps.push(`Detected database usage (${uniqueTables.slice(0, 3).join(", ")}) but no database verification.`);
    recommendations.push({
      type: "database",
      summary: `Verify seed state and critical queries for tables: ${uniqueTables.slice(0, 3).join(", ")}`,
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

  return {
    project: {
      name: path.basename(cwd),
      source_roots: sourceRoots.map(p => relative(cwd, p) || "."),
      configured_src_dir: configuredSrcDir || null,
      scanned_files: files.length,
    },
    coverage,
    detected: {
      ui_routes: uniqueRoutes,
      api_endpoints: uniqueApis,
      db_tables: uniqueTables,
      auth_signals: authSignals,
      security_signals: securitySignals,
    },
    recommendations,
  };
}

export function map({ cwd, json = false }) {
  const result = buildMap(cwd);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatHuman(result));
  }
  return { exitCode: 0, result };
}
