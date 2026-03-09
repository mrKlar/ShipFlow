#!/usr/bin/env node
// ShipFlow technical backend
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(process.cwd(), ".");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SPEC = {
  "id": "technical-sqlite-runtime",
  "title": "Requested SQLite runtime stays portable",
  "category": "framework",
  "framework": "custom",
  "backend": {
    "framework": "custom",
    "packages": [],
    "targets": [
      "."
    ],
    "rules": [],
    "config_file": null,
    "needs_typescript_parser": false
  },
  "generic_assertions": [
    {
      "path_exists": {
        "path": "package.json"
      }
    },
    {
      "dependency_absent": {
        "name": "better-sqlite3",
        "section": "all",
        "path": "package.json"
      }
    },
    {
      "dependency_absent": {
        "name": "sqlite3",
        "section": "all",
        "path": "package.json"
      }
    }
  ]
};

function repoPath(rel) { return path.resolve(ROOT, rel); }
function artifactPath(rel) { return path.resolve(SCRIPT_DIR, rel); }
function assertCondition(condition, message) { if (!condition) throw new Error(message); }
function assertDeepEqual(left, right, message) { if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(message + "\nexpected: " + JSON.stringify(right) + "\nreceived: " + JSON.stringify(left)); }
function assertMatches(value, pattern, message) { if (!(new RegExp(pattern)).test(String(value ?? ""))) throw new Error(message + "\nreceived: " + String(value ?? "")); }
function exists(rel) { return fs.existsSync(repoPath(rel)); }
function readText(rel) { return fs.readFileSync(repoPath(rel), "utf-8"); }
function readJson(rel) { return JSON.parse(readText(rel)); }
function jsonQuery(file, query) {
  const root = readJson(file);
  return Function("root", "return " + query.replace(/^\$/, "root"))(root);
}
function hasDependency(rel, name, section) {
  const pkg = readJson(rel);
  const sections = section ? [section] : ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  return sections.some(key => pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], name));
}
function dependencyVersion(rel, name, section) {
  const pkg = readJson(rel);
  const sections = section ? [section] : ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  for (const key of sections) {
    if (pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], name)) return pkg[key][name];
  }
  return undefined;
}
function packageScript(rel, name) {
  const pkg = readJson(rel);
  return pkg.scripts ? pkg.scripts[name] : undefined;
}
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*\*\/?/g, token => token.endsWith("/") ? "__DOUBLE_STAR_DIR__" : "__DOUBLE_STAR__").replace(/\*/g, "[^/]*").replace(/__DOUBLE_STAR_DIR__/g, "(?:.*\\/)?").replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp("^" + pattern + "$");
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === "node_modules" || ent.name === ".gen" || ent.name === "vp" || ent.name === "evidence") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(path.relative(ROOT, full).replaceAll("\\", "/"));
  }
  return out;
}
function globFiles(glob) {
  const re = globToRegExp(glob);
  return walk(ROOT).filter(file => re.test(file));
}
function normalizeRoutePath(routePath) {
  const normalized = String(routePath || "").replaceAll("\\", "/").trim();
  if (!normalized) return "/";
  const withSlash = normalized.startsWith("/") ? normalized : "/" + normalized;
  return withSlash.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
function routePathFromFile(file) {
  const normalized = String(file || "").replaceAll("\\", "/");
  let match = normalized.match(/^app\/api\/(.+)\/route\.[^.]+$/);
  if (match) return normalizeRoutePath("/api/" + match[1]);
  match = normalized.match(/^pages\/api\/(.+)\.[^.]+$/);
  if (match) {
    const suffix = match[1].replace(/\/index$/, "");
    return normalizeRoutePath("/api/" + suffix);
  }
  return null;
}
function detectDeclaredHttpRoutes(glob) {
  const routes = [];
  const files = globFiles(glob);
  for (const file of files) {
    const content = readText(file);
    for (const match of content.matchAll(/\b(?:app|router|server|fastify)\.(get|post|put|patch|delete|options|head|all)\(\s*["'` ]([^"'`]+)["'`]/gi)) {
      const method = match[1].toUpperCase() === "ALL" ? "ANY" : match[1].toUpperCase();
      routes.push({ file, method, path: normalizeRoutePath(match[2]) });
    }
    for (const match of content.matchAll(/(?:pathname|url\.pathname|path)\s*===\s*["'`]([^"'`]+)["'`]\s*&&\s*(?:req|request)\.method\s*===\s*["'`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'`]/g)) {
      routes.push({ file, method: match[2].toUpperCase(), path: normalizeRoutePath(match[1]) });
    }
    for (const match of content.matchAll(/(?:req|request)\.method\s*===\s*["'`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'`]\s*&&\s*(?:pathname|url\.pathname|path)\s*===\s*["'`]([^"'`]+)["'`]/g)) {
      routes.push({ file, method: match[1].toUpperCase(), path: normalizeRoutePath(match[2]) });
    }
    for (const match of content.matchAll(/(?:pathname|url\.pathname|path)\s*===\s*["'`]([^"'`]+)["'`]\s*&&\s*method\s*===\s*["'`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'`]/g)) {
      routes.push({ file, method: match[2].toUpperCase(), path: normalizeRoutePath(match[1]) });
    }
    for (const match of content.matchAll(/method\s*===\s*["'`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'`]\s*&&\s*(?:pathname|url\.pathname|path)\s*===\s*["'`]([^"'`]+)["'`]/g)) {
      routes.push({ file, method: match[1].toUpperCase(), path: normalizeRoutePath(match[2]) });
    }
    const nextRoute = routePathFromFile(file);
    if (nextRoute) {
      const methods = [...content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)].map(match => match[1].toUpperCase());
      if (methods.length === 0) routes.push({ file, method: "ANY", path: nextRoute });
      else for (const method of [...new Set(methods)]) routes.push({ file, method, path: nextRoute });
    }
  }
  return routes;
}
function routeAllowed(routePath, allowPaths) {
  return (allowPaths || []).some(pattern => {
    const normalized = normalizeRoutePath(pattern);
    if (normalized.endsWith("*")) return routePath.startsWith(normalized.slice(0, -1));
    return routePath === normalized;
  });
}
function graphqlEndpointCandidates(endpoint) {
  const primary = normalizeRoutePath(endpoint || "/graphql");
  const candidates = new Set([primary]);
  if (!primary.startsWith("/api/")) candidates.add(normalizeRoutePath("/api" + primary));
  if (primary.startsWith("/api/")) candidates.add(normalizeRoutePath(primary.replace(/^\/api/, "")));
  return [...candidates];
}
function hasGraphqlIndicators(content) {
  const patterns = [
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
  return patterns.some(pattern => pattern.test(content));
}
function assertGraphqlSurfacePresent(config) {
  const files = globFiles(config.files || "src/**/*");
  const endpointCandidates = graphqlEndpointCandidates(config.endpoint);
  const graphqlFiles = files.filter(file => hasGraphqlIndicators(readText(file)));
  assertCondition(graphqlFiles.length > 0, "Expected GraphQL server indicators in " + (config.files || "src/**/*"));
  const routes = detectDeclaredHttpRoutes(config.files || "src/**/*");
  const routeMatch = routes.find(route => endpointCandidates.includes(route.path));
  const endpointMention = graphqlFiles.some(file => endpointCandidates.some(candidate => readText(file).includes(candidate)));
  assertCondition(Boolean(routeMatch) || endpointMention, "Expected GraphQL endpoint " + endpointCandidates.join(" or ") + " to be declared.");
  if (config.require_schema) {
    const schemaFound = (config.schema_globs || []).some(glob => globFiles(glob).length > 0);
    assertCondition(schemaFound, "Expected GraphQL schema files matching: " + (config.schema_globs || []).join(", "));
  }
}
function assertGraphqlSurfaceAbsent(config) {
  const files = globFiles(config.files || "src/**/*");
  const endpointCandidates = graphqlEndpointCandidates(config.endpoint);
  const graphqlFiles = files.filter(file => hasGraphqlIndicators(readText(file)));
  const routes = detectDeclaredHttpRoutes(config.files || "src/**/*");
  const routeMatch = routes.find(route => endpointCandidates.includes(route.path));
  const endpointMention = graphqlFiles.some(file => endpointCandidates.some(candidate => readText(file).includes(candidate)));
  assertCondition(graphqlFiles.length === 0 && !routeMatch && !endpointMention, "Expected no GraphQL surface for " + endpointCandidates.join(" or "));
}
function routeMatchesMethod(routeMethod, methods) {
  if (!methods || methods.length === 0) return true;
  if (routeMethod === "ANY") return true;
  return methods.includes(routeMethod) || methods.includes("ANY");
}
function restRoutesMatching(config) {
  const routes = detectDeclaredHttpRoutes(config.files || "src/**/*");
  const prefix = normalizeRoutePath(config.path_prefix || "/api/");
  const methods = Array.isArray(config.methods) && config.methods.length > 0 ? config.methods : null;
  return routes.filter(route => route.path.startsWith(prefix) && routeMatchesMethod(route.method, methods) && !routeAllowed(route.path, config.allow_paths || []));
}
function assertRestApiPresent(config) {
  const matches = restRoutesMatching(config);
  const methodsLabel = Array.isArray(config.methods) && config.methods.length > 0 ? config.methods.join(", ") : "any method";
  assertCondition(matches.length > 0, "Expected REST API routes under " + normalizeRoutePath(config.path_prefix || "/api/") + " for " + methodsLabel);
}
function assertRestApiAbsent(config) {
  const matches = restRoutesMatching(config);
  assertCondition(matches.length === 0, "Expected no REST API routes under " + normalizeRoutePath(config.path_prefix || "/api/") + ", but found: " + matches.map(route => route.method + " " + route.path + " [" + route.file + "]").join(", "));
}
function parseImports(content) {
  const imports = [];
  for (const match of content.matchAll(/import\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g)) imports.push(match[1]);
  for (const match of content.matchAll(/export\s+[^"'`]*?from\s+["'`]([^"'`]+)["'`]/g)) imports.push(match[1]);
  for (const match of content.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) imports.push(match[1]);
  for (const match of content.matchAll(/import\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) imports.push(match[1]);
  return imports;
}
function resolveRelativeImport(fromFile, specifier) {
  const base = path.dirname(repoPath(fromFile));
  const candidates = [specifier, specifier + ".js", specifier + ".ts", specifier + ".tsx", specifier + ".jsx", specifier + ".mjs", specifier + ".cjs", path.join(specifier, "index.js"), path.join(specifier, "index.ts"), path.join(specifier, "index.tsx"), path.join(specifier, "index.mjs"), path.join(specifier, "index.cjs")];
  for (const candidate of candidates) {
    const full = path.resolve(base, candidate);
    if (fs.existsSync(full)) return path.relative(ROOT, full).replaceAll("\\", "/");
  }
  return path.relative(ROOT, path.resolve(base, specifier)).replaceAll("\\", "/");
}
function assertForbiddenImports(glob, patterns) {
  const files = globFiles(glob);
  for (const file of files) {
    const imports = parseImports(readText(file));
    for (const pattern of patterns) {
      const violated = imports.some(specifier => specifier === pattern || specifier.startsWith(pattern.replace(/\*\*$/, ""))) || readText(file).includes(pattern);
      assertCondition(!violated, file + " should not import or reference " + pattern);
    }
  }
}
function assertAllowedImports(glob, patterns, allowRelative) {
  const files = globFiles(glob);
  for (const file of files) {
    const imports = parseImports(readText(file));
    for (const specifier of imports) {
      if (allowRelative && (specifier.startsWith("./") || specifier.startsWith("../"))) continue;
      const ok = patterns.some(pattern => specifier === pattern || specifier.startsWith(pattern.replace(/\*\*$/, "")));
      assertCondition(ok, file + " imports disallowed module " + specifier);
    }
  }
}
function assertLayerDependencies(config) {
  const layers = config.layers.map(layer => ({ ...layer, filesMatched: globFiles(layer.files) }));
  function layerForFile(file) { return layers.find(layer => layer.filesMatched.includes(file)); }
  for (const layer of layers) {
    for (const file of layer.filesMatched) {
      for (const specifier of parseImports(readText(file))) {
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
          if (!config.allow_external) assertCondition(false, file + " imports external module " + specifier);
          continue;
        }
        const targetFile = resolveRelativeImport(file, specifier);
        const targetLayer = layerForFile(targetFile);
        if (!targetLayer) {
          if (!config.allow_unmatched_relative) assertCondition(false, file + " imports unmatched relative path " + specifier);
          continue;
        }
        if (config.allow_same_layer && targetLayer.name === layer.name) continue;
        assertCondition(layer.may_import.includes(targetLayer.name), file + " (" + layer.name + ") must not import " + targetLayer.name + " via " + specifier);
      }
    }
  }
}
function assertNoCircularDependencies(glob) {
  const files = globFiles(glob);
  const graph = new Map();
  for (const file of files) {
    const edges = [];
    for (const specifier of parseImports(readText(file))) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      const target = resolveRelativeImport(file, specifier);
      if (files.includes(target)) edges.push(target);
    }
    graph.set(file, edges);
  }
  const visited = new Set();
  const stack = new Set();
  const pathStack = [];
  function visit(node) {
    if (stack.has(node)) {
      const cycleStart = pathStack.indexOf(node);
      const cycle = pathStack.slice(cycleStart).concat(node);
      throw new Error("Circular dependency detected: " + cycle.join(" -> "));
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    pathStack.push(node);
    for (const next of graph.get(node) || []) visit(next);
    pathStack.pop();
    stack.delete(node);
  }
  for (const file of graph.keys()) visit(file);
}
function runCommand(command, relCwd) {
  const cwd = relCwd ? repoPath(relCwd) : ROOT;
  try {
    const stdout = spawnSync("bash", ["-lc", command], { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return { ok: stdout.status === 0, stdout: (stdout.stdout || "") + (stdout.stderr || ""), exit_code: stdout.status ?? 1 };
  } catch (err) {
    return { ok: false, stdout: String(err.message || err), exit_code: 1 };
  }
}
async function runDependencyCruiser(backend) {
  if (!backend.rules || backend.rules.length === 0) return;
  const args = ["depcruise", "--output-type", "err-long", "--config", artifactPath(backend.config_file), ...backend.targets];
  const res = spawnSync("npx", args, { cwd: ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  const output = (res.stdout || "") + (res.stderr || "");
  if (res.status !== 0) throw new Error("dependency-cruiser reported violations\n" + output.trim());
}
async function runMadge(backend) {
  if (!backend.rules || backend.rules.length === 0) return;
  const { default: madge } = await import("madge");
  for (const rule of backend.rules) {
    const result = await madge(repoPath(rule.base), { fileExtensions: rule.extensions, tsConfig: rule.tsconfig ? repoPath(rule.tsconfig) : undefined });
    const cycles = result.circular();
    if (cycles.length > 0) throw new Error("madge detected circular dependencies under " + rule.base + "\n" + JSON.stringify(cycles, null, 2));
  }
}
async function runTsarch(backend) {
  if (!backend.rules || backend.rules.length === 0) return;
  const { filesOfProject } = await import("tsarch");
  const violations = [];
  for (const rule of backend.rules) {
    if (rule.kind === "forbidden-import") {
      for (const pattern of rule.patterns) {
        const res = await filesOfProject().matchingPattern(rule.files).shouldNot().dependOnFiles().matchingPattern(pattern).check();
        if (Array.isArray(res) && res.length > 0) violations.push("tsarch forbidden import violation from " + rule.files + " to " + pattern + "\n" + JSON.stringify(res, null, 2));
      }
    }
    if (rule.kind === "layer-dependencies") {
      const layers = rule.config.layers || [];
      for (const layer of layers) {
        for (const target of layers) {
          if (target.name === layer.name && rule.config.allow_same_layer !== false) continue;
          if (target.name !== layer.name && layer.may_import.includes(target.name)) continue;
          const res = await filesOfProject().matchingPattern(layer.files).shouldNot().dependOnFiles().matchingPattern(target.files).check();
          if (Array.isArray(res) && res.length > 0) violations.push("tsarch layer dependency violation from " + layer.name + " to " + target.name + "\n" + JSON.stringify(res, null, 2));
        }
      }
    }
    if (rule.kind === "no-circular-dependencies") {
      const res = await filesOfProject().matchingPattern(rule.files).should().beFreeOfCycles().check();
      if (Array.isArray(res) && res.length > 0) violations.push("tsarch circular dependency violation in " + rule.files + "\n" + JSON.stringify(res, null, 2));
    }
  }
  if (violations.length > 0) throw new Error(violations.join("\n\n"));
}
async function runEslintBoundaries(backend) {
  if (!backend.config_file) return;
  if (backend.needs_typescript_parser) {
    try {
      await import("@typescript-eslint/parser");
    } catch {
      throw new Error("eslint-plugin-boundaries backend needs @typescript-eslint/parser for TypeScript patterns.");
    }
  }
  const baseArgs = ["eslint", "--format", "json", "--config", artifactPath(backend.config_file), ...backend.targets];
  let res = spawnSync("npx", ["--yes", "eslint", "--no-config-lookup", ...baseArgs.slice(1)], { cwd: ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  let output = (res.stdout || "") + (res.stderr || "");
  if (/Unknown option ['"]--no-config-lookup['"]/.test(output)) {
    res = spawnSync("npx", ["--yes", "eslint", "--no-eslintrc", ...baseArgs.slice(1)], { cwd: ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    output = (res.stdout || "") + (res.stderr || "");
  }
  if (res.status !== 0) throw new Error("eslint-plugin-boundaries reported violations\n" + output.trim());
}
async function runFrameworkBackend(backend) {
  if (!backend || !backend.framework || backend.framework === "custom" || backend.framework === "archtest") return;
  if (backend.framework === "dependency-cruiser") return runDependencyCruiser(backend);
  if (backend.framework === "madge") return runMadge(backend);
  if (backend.framework === "tsarch") return runTsarch(backend);
  if (backend.framework === "eslint-plugin-boundaries") return runEslintBoundaries(backend);
}
function runGenericAssertions(assertions) {
  for (const assertion of assertions || []) {
    if (assertion.path_exists) { assertCondition(exists(assertion.path_exists.path), "Expected path to exist: " + assertion.path_exists.path); continue; }
    if (assertion.path_absent) { assertCondition(!exists(assertion.path_absent.path), "Expected path to be absent: " + assertion.path_absent.path); continue; }
    if (assertion.file_contains) { assertCondition(readText(assertion.file_contains.path).includes(assertion.file_contains.text), "Expected " + assertion.file_contains.path + " to contain " + assertion.file_contains.text); continue; }
    if (assertion.file_not_contains) { assertCondition(!readText(assertion.file_not_contains.path).includes(assertion.file_not_contains.text), "Expected " + assertion.file_not_contains.path + " not to contain " + assertion.file_not_contains.text); continue; }
    if (assertion.json_has) { assertCondition(jsonQuery(assertion.json_has.path, assertion.json_has.query) !== undefined, "Expected " + assertion.json_has.path + " " + assertion.json_has.query + " to be defined"); continue; }
    if (assertion.json_equals) { assertDeepEqual(jsonQuery(assertion.json_equals.path, assertion.json_equals.query), assertion.json_equals.equals, "Expected " + assertion.json_equals.path + " " + assertion.json_equals.query + " to equal " + JSON.stringify(assertion.json_equals.equals)); continue; }
    if (assertion.json_matches) { assertMatches(jsonQuery(assertion.json_matches.path, assertion.json_matches.query), assertion.json_matches.matches, "Expected " + assertion.json_matches.path + " " + assertion.json_matches.query + " to match " + assertion.json_matches.matches); continue; }
    if (assertion.dependency_present) {
      const section = assertion.dependency_present.section === "all" ? undefined : assertion.dependency_present.section;
      assertCondition(hasDependency(assertion.dependency_present.path, assertion.dependency_present.name, section), "Expected dependency " + assertion.dependency_present.name + " to be declared in " + assertion.dependency_present.path);
      continue;
    }
    if (assertion.dependency_absent) {
      const section = assertion.dependency_absent.section === "all" ? undefined : assertion.dependency_absent.section;
      assertCondition(!hasDependency(assertion.dependency_absent.path, assertion.dependency_absent.name, section), "Expected dependency " + assertion.dependency_absent.name + " to be absent from " + assertion.dependency_absent.path);
      continue;
    }
    if (assertion.dependency_version_matches) {
      const section = assertion.dependency_version_matches.section === "all" ? undefined : assertion.dependency_version_matches.section;
      assertMatches(dependencyVersion(assertion.dependency_version_matches.path, assertion.dependency_version_matches.name, section), assertion.dependency_version_matches.matches, "Expected dependency " + assertion.dependency_version_matches.name + " version in " + assertion.dependency_version_matches.path + " to match " + assertion.dependency_version_matches.matches);
      continue;
    }
    if (assertion.script_present) { assertCondition(packageScript(assertion.script_present.path, assertion.script_present.name) !== undefined, "Expected script " + assertion.script_present.name + " to exist in " + assertion.script_present.path); continue; }
    if (assertion.script_contains) { assertCondition(String(packageScript(assertion.script_contains.path, assertion.script_contains.name) || "").includes(assertion.script_contains.text), "Expected script " + assertion.script_contains.name + " in " + assertion.script_contains.path + " to contain " + assertion.script_contains.text); continue; }
    if (assertion.github_action_uses) { assertCondition(readText(assertion.github_action_uses.workflow).includes(assertion.github_action_uses.action), "Expected " + assertion.github_action_uses.workflow + " to use " + assertion.github_action_uses.action); continue; }
    if (assertion.glob_count) { assertCondition(globFiles(assertion.glob_count.glob).length === assertion.glob_count.equals, "Expected " + assertion.glob_count.glob + " to match " + assertion.glob_count.equals + " file(s)"); continue; }
    if (assertion.glob_count_gte) { assertCondition(globFiles(assertion.glob_count_gte.glob).length >= assertion.glob_count_gte.gte, "Expected " + assertion.glob_count_gte.glob + " to match at least " + assertion.glob_count_gte.gte + " file(s)"); continue; }
    if (assertion.graphql_surface_present) { assertGraphqlSurfacePresent(assertion.graphql_surface_present); continue; }
    if (assertion.graphql_surface_absent) { assertGraphqlSurfaceAbsent(assertion.graphql_surface_absent); continue; }
    if (assertion.rest_api_present) { assertRestApiPresent(assertion.rest_api_present); continue; }
    if (assertion.rest_api_absent) { assertRestApiAbsent(assertion.rest_api_absent); continue; }
    if (assertion.imports_forbidden) { assertForbiddenImports(assertion.imports_forbidden.files, assertion.imports_forbidden.patterns); continue; }
    if (assertion.imports_allowed_only_from) { assertAllowedImports(assertion.imports_allowed_only_from.files, assertion.imports_allowed_only_from.patterns, assertion.imports_allowed_only_from.allow_relative); continue; }
    if (assertion.layer_dependencies) { assertLayerDependencies(assertion.layer_dependencies); continue; }
    if (assertion.no_circular_dependencies) { assertNoCircularDependencies(assertion.no_circular_dependencies.files); continue; }
    if (assertion.command_succeeds) { const res = runCommand(assertion.command_succeeds.command, assertion.command_succeeds.cwd); assertCondition(res.ok, "Expected command to succeed: " + assertion.command_succeeds.command + "\n" + res.stdout); continue; }
    if (assertion.command_stdout_contains) { const res = runCommand(assertion.command_stdout_contains.command, assertion.command_stdout_contains.cwd); assertCondition(res.stdout.includes(assertion.command_stdout_contains.text), "Expected command output to contain " + assertion.command_stdout_contains.text + "\n" + res.stdout); continue; }
    if (assertion.command_stdout_not_contains) { const res = runCommand(assertion.command_stdout_not_contains.command, assertion.command_stdout_not_contains.cwd); assertCondition(!res.stdout.includes(assertion.command_stdout_not_contains.text), "Expected command output not to contain " + assertion.command_stdout_not_contains.text + "\n" + res.stdout); continue; }
    throw new Error("Unknown technical assertion shape: " + JSON.stringify(assertion));
  }
}
async function main() {
  assertCondition(!exists("__shipflow_false_positive__/missing"), "False positive guard failed");
  assertCondition(globFiles("__shipflow_false_positive__/**").length === 0, "False positive guard glob should be empty");
  if (exists("package.json")) assertCondition(!hasDependency("package.json", "__shipflow_false_positive__"), "False positive guard dependency should be absent");
  await runFrameworkBackend(SPEC.backend);
  runGenericAssertions(SPEC.generic_assertions);
  console.log("[ShipFlow technical] PASS " + SPEC.id + " [" + "custom" + "]");
}

main().catch(error => {
  console.error("[ShipFlow technical] FAIL " + SPEC.id + ": " + (error && error.stack ? error.stack : error));
  process.exit(1);
});
