import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { TechnicalCheck } from "./schema/technical-check.zod.js";
import {
  deriveTechnicalFrameworkTargets,
  frameworkPackages,
  globBase,
  isPathLikePattern,
  splitTechnicalAssertions,
  technicalFrameworkFor,
  usesTypeScriptPatterns,
} from "./technical-frameworks.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

export function readTechnicalChecks(vpDir) {
  const dir = path.join(vpDir, "technical");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(dir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = TechnicalCheck.parse(raw);
      parsed.__file = `vp/technical/${f}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/technical/${f}`, err);
      throw err;
    }
  });
}

function jsExprFromQuery(query, rootExpr) {
  return query.replace(/^\$/, rootExpr);
}

export function technicalAssertExpr(a) {
  if (a.path_exists) {
    return `assertCondition(exists(${JSON.stringify(a.path_exists.path)}), ${JSON.stringify(`Expected path to exist: ${a.path_exists.path}`)});`;
  }
  if (a.path_absent) {
    return `assertCondition(!exists(${JSON.stringify(a.path_absent.path)}), ${JSON.stringify(`Expected path to be absent: ${a.path_absent.path}`)});`;
  }
  if (a.file_contains) {
    return `assertCondition(readText(${JSON.stringify(a.file_contains.path)}).includes(${JSON.stringify(a.file_contains.text)}), ${JSON.stringify(`Expected ${a.file_contains.path} to contain ${a.file_contains.text}`)});`;
  }
  if (a.file_not_contains) {
    return `assertCondition(!readText(${JSON.stringify(a.file_not_contains.path)}).includes(${JSON.stringify(a.file_not_contains.text)}), ${JSON.stringify(`Expected ${a.file_not_contains.path} not to contain ${a.file_not_contains.text}`)});`;
  }
  if (a.json_has) {
    return `assertCondition(jsonQuery(${JSON.stringify(a.json_has.path)}, ${JSON.stringify(a.json_has.query)}) !== undefined, ${JSON.stringify(`Expected ${a.json_has.path} ${a.json_has.query} to be defined`)});`;
  }
  if (a.json_equals) {
    return `assertDeepEqual(${jsExprFromQuery(a.json_equals.query, `readJson(${JSON.stringify(a.json_equals.path)})`)}, ${JSON.stringify(a.json_equals.equals)}, ${JSON.stringify(`Expected ${a.json_equals.path} ${a.json_equals.query} to equal ${JSON.stringify(a.json_equals.equals)}`)});`;
  }
  if (a.json_matches) {
    return `assertMatches(String(jsonQuery(${JSON.stringify(a.json_matches.path)}, ${JSON.stringify(a.json_matches.query)}) ?? ""), ${JSON.stringify(a.json_matches.matches)}, ${JSON.stringify(`Expected ${a.json_matches.path} ${a.json_matches.query} to match ${a.json_matches.matches}`)});`;
  }
  if (a.dependency_present) {
    const sectionExpr = a.dependency_present.section === "all"
      ? `hasDependency(${JSON.stringify(a.dependency_present.path)}, ${JSON.stringify(a.dependency_present.name)})`
      : `hasDependency(${JSON.stringify(a.dependency_present.path)}, ${JSON.stringify(a.dependency_present.name)}, ${JSON.stringify(a.dependency_present.section)})`;
    return `assertCondition(${sectionExpr}, ${JSON.stringify(`Expected dependency ${a.dependency_present.name} to be declared in ${a.dependency_present.path}`)});`;
  }
  if (a.dependency_absent) {
    const sectionExpr = a.dependency_absent.section === "all"
      ? `hasDependency(${JSON.stringify(a.dependency_absent.path)}, ${JSON.stringify(a.dependency_absent.name)})`
      : `hasDependency(${JSON.stringify(a.dependency_absent.path)}, ${JSON.stringify(a.dependency_absent.name)}, ${JSON.stringify(a.dependency_absent.section)})`;
    return `assertCondition(!${sectionExpr}, ${JSON.stringify(`Expected dependency ${a.dependency_absent.name} to be absent from ${a.dependency_absent.path}`)});`;
  }
  if (a.dependency_version_matches) {
    const sectionExpr = a.dependency_version_matches.section === "all"
      ? `dependencyVersion(${JSON.stringify(a.dependency_version_matches.path)}, ${JSON.stringify(a.dependency_version_matches.name)})`
      : `dependencyVersion(${JSON.stringify(a.dependency_version_matches.path)}, ${JSON.stringify(a.dependency_version_matches.name)}, ${JSON.stringify(a.dependency_version_matches.section)})`;
    return `assertMatches(String(${sectionExpr} ?? ""), ${JSON.stringify(a.dependency_version_matches.matches)}, ${JSON.stringify(`Expected dependency ${a.dependency_version_matches.name} version in ${a.dependency_version_matches.path} to match ${a.dependency_version_matches.matches}`)});`;
  }
  if (a.script_present) {
    return `assertCondition(packageScript(${JSON.stringify(a.script_present.path)}, ${JSON.stringify(a.script_present.name)}) !== undefined, ${JSON.stringify(`Expected script ${a.script_present.name} to exist in ${a.script_present.path}`)});`;
  }
  if (a.script_contains) {
    return `assertCondition(String(packageScript(${JSON.stringify(a.script_contains.path)}, ${JSON.stringify(a.script_contains.name)}) ?? "").includes(${JSON.stringify(a.script_contains.text)}), ${JSON.stringify(`Expected script ${a.script_contains.name} in ${a.script_contains.path} to contain ${a.script_contains.text}`)});`;
  }
  if (a.github_action_uses) {
    const { workflow, action } = a.github_action_uses;
    return `assertCondition(readText(${JSON.stringify(workflow)}).includes(${JSON.stringify(action)}), ${JSON.stringify(`Expected ${workflow} to use ${action}`)});`;
  }
  if (a.glob_count) {
    return `assertCondition(globFiles(${JSON.stringify(a.glob_count.glob)}).length === ${a.glob_count.equals}, ${JSON.stringify(`Expected ${a.glob_count.glob} to match ${a.glob_count.equals} file(s)`)});`;
  }
  if (a.glob_count_gte) {
    return `assertCondition(globFiles(${JSON.stringify(a.glob_count_gte.glob)}).length >= ${a.glob_count_gte.gte}, ${JSON.stringify(`Expected ${a.glob_count_gte.glob} to match at least ${a.glob_count_gte.gte} file(s)`)});`;
  }
  if (a.graphql_surface_present) {
    return `assertGraphqlSurfacePresent(${JSON.stringify(a.graphql_surface_present)});`;
  }
  if (a.graphql_surface_absent) {
    return `assertGraphqlSurfaceAbsent(${JSON.stringify(a.graphql_surface_absent)});`;
  }
  if (a.rest_api_present) {
    return `assertRestApiPresent(${JSON.stringify(a.rest_api_present)});`;
  }
  if (a.rest_api_absent) {
    return `assertRestApiAbsent(${JSON.stringify(a.rest_api_absent)});`;
  }
  if (a.imports_forbidden) {
    const { files, patterns } = a.imports_forbidden;
    return `assertForbiddenImports(${JSON.stringify(files)}, ${JSON.stringify(patterns)});`;
  }
  if (a.imports_allowed_only_from) {
    const { files, patterns, allow_relative } = a.imports_allowed_only_from;
    return `assertAllowedImports(${JSON.stringify(files)}, ${JSON.stringify(patterns)}, ${allow_relative});`;
  }
  if (a.layer_dependencies) {
    return `assertLayerDependencies(${JSON.stringify(a.layer_dependencies)});`;
  }
  if (a.no_circular_dependencies) {
    return `assertNoCircularDependencies(${JSON.stringify(a.no_circular_dependencies.files)});`;
  }
  if (a.command_succeeds) {
    const cwd = a.command_succeeds.cwd ? JSON.stringify(a.command_succeeds.cwd) : "undefined";
    return `assertCondition(runCommand(${JSON.stringify(a.command_succeeds.command)}, ${cwd}).ok, ${JSON.stringify(`Expected command to succeed: ${a.command_succeeds.command}`)});`;
  }
  if (a.command_stdout_contains) {
    const cwd = a.command_stdout_contains.cwd ? JSON.stringify(a.command_stdout_contains.cwd) : "undefined";
    return `assertCondition(runCommand(${JSON.stringify(a.command_stdout_contains.command)}, ${cwd}).stdout.includes(${JSON.stringify(a.command_stdout_contains.text)}), ${JSON.stringify(`Expected command output to contain ${a.command_stdout_contains.text}`)});`;
  }
  if (a.command_stdout_not_contains) {
    const cwd = a.command_stdout_not_contains.cwd ? JSON.stringify(a.command_stdout_not_contains.cwd) : "undefined";
    return `assertCondition(!runCommand(${JSON.stringify(a.command_stdout_not_contains.command)}, ${cwd}).stdout.includes(${JSON.stringify(a.command_stdout_not_contains.text)}), ${JSON.stringify(`Expected command output not to contain ${a.command_stdout_not_contains.text}`)});`;
  }
  throw new Error("Unknown technical assert");
}

function technicalBaseName(check) {
  return check.__file.replaceAll("/", "_").replace(/\.ya?ml$/, "");
}

function escapeRegex(text) {
  return String(text).replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globRegexSource(glob, { prefix = false } = {}) {
  const normalized = String(glob || "").replaceAll("\\", "/");
  if (!normalized || normalized === ".") return ".*";
  if (prefix) return `^${escapeRegex(normalized.replace(/\/+$/, ""))}`;
  return `^${escapeRegex(normalized).replaceAll("\\*\\*", "__DOUBLE_STAR__").replaceAll("\\*", "[^/]*").replaceAll("__DOUBLE_STAR__", ".*")}$`;
}

function pathPatternRegexSource(pattern) {
  const normalized = String(pattern || "").replaceAll("\\", "/");
  if (!normalized) return ".*";
  if (normalized.includes("*")) return globRegexSource(normalized);
  if (normalized.endsWith("/")) return `^${escapeRegex(normalized)}`;
  return `^${escapeRegex(normalized)}(?:$|/)`;
}

function joinRegexSources(sources) {
  const filtered = [...new Set(sources.filter(Boolean))];
  if (filtered.length === 0) return ".*";
  if (filtered.length === 1) return filtered[0];
  return `(?:${filtered.join("|")})`;
}

function buildDependencyCruiserRules(assertions) {
  const rules = [];
  let index = 0;
  for (const assertion of assertions) {
    if (assertion.imports_forbidden) {
      const pathPatterns = assertion.imports_forbidden.patterns.filter(isPathLikePattern);
      if (pathPatterns.length === 0) continue;
      for (const pattern of pathPatterns) {
        index += 1;
        rules.push({
          name: `shipflow-forbidden-import-${index}`,
          severity: "error",
          from: { path: globRegexSource(assertion.imports_forbidden.files) },
          to: { path: pathPatternRegexSource(pattern) },
        });
      }
    }
    if (assertion.layer_dependencies) {
      const { layers, allow_same_layer } = assertion.layer_dependencies;
      for (const layer of layers) {
        const disallowed = layers.filter(candidate => {
          if (candidate.name === layer.name) return allow_same_layer === false;
          return !layer.may_import.includes(candidate.name);
        });
        if (disallowed.length === 0) continue;
        index += 1;
        rules.push({
          name: `shipflow-layer-dependencies-${index}-${layer.name}`,
          severity: "error",
          from: { path: globRegexSource(layer.files) },
          to: { path: joinRegexSources(disallowed.map(candidate => globRegexSource(candidate.files))) },
        });
      }
    }
  }
  return rules;
}

function genDependencyCruiserConfig(assertions) {
  const forbidden = buildDependencyCruiserRules(assertions);
  return [
    `export default ${JSON.stringify({ forbidden }, null, 2)};`,
    "",
  ].join("\n");
}

function buildTsarchRules(assertions) {
  const rules = [];
  for (const assertion of assertions) {
    if (assertion.imports_forbidden) {
      const patterns = assertion.imports_forbidden.patterns.filter(isPathLikePattern);
      if (patterns.length > 0) {
        rules.push({
          kind: "forbidden-import",
          files: assertion.imports_forbidden.files,
          patterns,
        });
      }
    }
    if (assertion.layer_dependencies) {
      rules.push({
        kind: "layer-dependencies",
        config: assertion.layer_dependencies,
      });
    }
    if (assertion.no_circular_dependencies) {
      rules.push({
        kind: "no-circular-dependencies",
        files: assertion.no_circular_dependencies.files,
      });
    }
  }
  return rules;
}

function buildMadgeRules(assertions) {
  return assertions
    .filter(assertion => assertion.no_circular_dependencies)
    .map(assertion => ({
      kind: "no-circular-dependencies",
      files: assertion.no_circular_dependencies.files,
      base: globBase(assertion.no_circular_dependencies.files),
      extensions: assertion.no_circular_dependencies.extensions,
      tsconfig: assertion.no_circular_dependencies.tsconfig || null,
    }));
}

function buildBoundariesConfig(assertions) {
  const layerAssertion = assertions.find(assertion => assertion.layer_dependencies);
  if (!layerAssertion) {
    return {
      config: null,
      targetGlobs: [],
      needsTypescriptParser: false,
    };
  }
  const { layers, allow_same_layer } = layerAssertion.layer_dependencies;
  const rules = layers.map(layer => ({
    from: layer.name,
    allow: allow_same_layer === false
      ? layer.may_import
      : [...new Set([layer.name, ...layer.may_import])],
  }));
  const elements = layers.map(layer => ({
    type: layer.name,
    pattern: layer.files,
  }));
  const targetGlobs = layers.map(layer => layer.files);
  const config = [
    `import boundaries from "eslint-plugin-boundaries";`,
    `let tsParser = null;`,
    `try {`,
    `  tsParser = (await import("@typescript-eslint/parser")).default;`,
    `} catch {`,
    `  tsParser = null;`,
    `}`,
    ``,
    `const languageOptions = tsParser`,
    `  ? { parser: tsParser, sourceType: "module", ecmaVersion: "latest" }`,
    `  : { sourceType: "module", ecmaVersion: "latest" };`,
    ``,
    `export default [`,
    `  {`,
    `    files: ${JSON.stringify(targetGlobs)},`,
    `    ignores: ["node_modules/**", ".git/**", ".gen/**", "evidence/**", "vp/**"],`,
    `    languageOptions,`,
    `    plugins: { boundaries },`,
    `    settings: { "boundaries/elements": ${JSON.stringify(elements, null, 6)} },`,
    `    rules: {`,
    `      "boundaries/element-types": ["error", { default: "disallow", rules: ${JSON.stringify(rules, null, 8)} }],`,
    `    },`,
    `  },`,
    `];`,
    ``,
  ].join("\n");
  return {
    config,
    targetGlobs,
    needsTypescriptParser: usesTypeScriptPatterns({ assert: assertions }),
  };
}

function buildTechnicalBackend(check, runnerName) {
  const { framework, backendAssertions, genericAssertions } = splitTechnicalAssertions(check);
  const backend = {
    framework,
    packages: frameworkPackages(framework, check),
    targets: deriveTechnicalFrameworkTargets(check, framework),
    rules: [],
    config_file: null,
    needs_typescript_parser: false,
  };
  const artifacts = [];
  const baseName = runnerName.replace(/\.runner\.mjs$/, "");

  if (framework === "dependency-cruiser" && backendAssertions.length > 0) {
    const configName = `${baseName}.depcruise.config.mjs`;
    artifacts.push({
      name: configName,
      relative_dir: "config",
      content: genDependencyCruiserConfig(backendAssertions),
      kind: "technical-config",
      primary: false,
    });
    backend.rules = buildDependencyCruiserRules(backendAssertions);
    backend.config_file = `config/${configName}`;
  } else if (framework === "madge" && backendAssertions.length > 0) {
    backend.rules = buildMadgeRules(backendAssertions);
  } else if (framework === "tsarch" && backendAssertions.length > 0) {
    backend.rules = buildTsarchRules(backendAssertions);
  } else if (framework === "eslint-plugin-boundaries" && backendAssertions.length > 0) {
    const configName = `${baseName}.eslint.config.mjs`;
    const config = buildBoundariesConfig(backendAssertions);
    artifacts.push({
      name: configName,
      relative_dir: "config",
      content: config.config,
      kind: "technical-config",
      primary: false,
    });
    backend.rules = [{
      kind: "layer-dependencies",
      target_globs: config.targetGlobs,
    }];
    backend.targets = config.targetGlobs.length > 0 ? config.targetGlobs : backend.targets;
    backend.config_file = `config/${configName}`;
    backend.needs_typescript_parser = config.needsTypescriptParser;
  }

  return { backend, artifacts, genericAssertions };
}

function genTechnicalRunner(check, backend, genericAssertions) {
  const runnerLabel = backend.framework || technicalFrameworkFor(check) || check.runner?.kind || "custom";
  const L = [];
  const spec = {
    id: check.id,
    title: check.title,
    category: check.category,
    framework: backend.framework,
    backend,
    generic_assertions: genericAssertions,
  };

  L.push(`#!/usr/bin/env node`);
  L.push(`// ShipFlow technical backend`);
  L.push(`import { spawnSync } from "node:child_process";`);
  L.push(`import fs from "node:fs";`);
  L.push(`import path from "node:path";`);
  L.push(`import process from "node:process";`);
  L.push(`import { fileURLToPath } from "node:url";`);
  L.push(``);
  L.push(`const ROOT = path.resolve(process.cwd(), ${JSON.stringify(check.app.root || ".")});`);
  L.push(`const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));`);
  L.push(`const SPEC = ${JSON.stringify(spec, null, 2)};`);
  L.push(``);
  L.push(`function repoPath(rel) { return path.resolve(ROOT, rel); }`);
  L.push(`function artifactPath(rel) { return path.resolve(SCRIPT_DIR, rel); }`);
  L.push(`function assertCondition(condition, message) { if (!condition) throw new Error(message); }`);
  L.push(`function assertDeepEqual(left, right, message) { if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(message + "\\nexpected: " + JSON.stringify(right) + "\\nreceived: " + JSON.stringify(left)); }`);
  L.push(`function assertMatches(value, pattern, message) { if (!(new RegExp(pattern)).test(String(value ?? ""))) throw new Error(message + "\\nreceived: " + String(value ?? "")); }`);
  L.push(`function exists(rel) { return fs.existsSync(repoPath(rel)); }`);
  L.push(`function readText(rel) { return fs.readFileSync(repoPath(rel), "utf-8"); }`);
  L.push(`function readJson(rel) { return JSON.parse(readText(rel)); }`);
  L.push(`function jsonQuery(file, query) {`);
  L.push(`  const root = readJson(file);`);
  L.push(`  return Function("root", "return " + query.replace(/^\\$/, "root"))(root);`);
  L.push(`}`);
  L.push(`function hasDependency(rel, name, section) {`);
  L.push(`  const pkg = readJson(rel);`);
  L.push(`  const sections = section ? [section] : ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];`);
  L.push(`  return sections.some(key => pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], name));`);
  L.push(`}`);
  L.push(`function dependencyVersion(rel, name, section) {`);
  L.push(`  const pkg = readJson(rel);`);
  L.push(`  const sections = section ? [section] : ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];`);
  L.push(`  for (const key of sections) {`);
  L.push(`    if (pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], name)) return pkg[key][name];`);
  L.push(`  }`);
  L.push(`  return undefined;`);
  L.push(`}`);
  L.push(`function packageScript(rel, name) {`);
  L.push(`  const pkg = readJson(rel);`);
  L.push(`  return pkg.scripts ? pkg.scripts[name] : undefined;`);
  L.push(`}`);
  L.push(`function globToRegExp(glob) {`);
  L.push('  const escaped = glob.replace(/[.+^${}()|[\\]\\\\]/g, "\\\\$&");');
  L.push(`  const pattern = escaped.replace(/\\*\\*\\/?/g, token => token.endsWith("/") ? "__DOUBLE_STAR_DIR__" : "__DOUBLE_STAR__").replace(/\\*/g, "[^/]*").replace(/__DOUBLE_STAR_DIR__/g, "(?:.*\\\\/)?").replace(/__DOUBLE_STAR__/g, ".*");`);
  L.push(`  return new RegExp("^" + pattern + "$");`);
  L.push(`}`);
  L.push(`function walk(dir, out = []) {`);
  L.push(`  if (!fs.existsSync(dir)) return out;`);
  L.push(`  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {`);
  L.push(`    if (ent.name === ".git" || ent.name === "node_modules" || ent.name === ".gen" || ent.name === "vp" || ent.name === "evidence") continue;`);
  L.push(`    const full = path.join(dir, ent.name);`);
  L.push(`    if (ent.isDirectory()) walk(full, out);`);
  L.push(`    else out.push(path.relative(ROOT, full).replaceAll("\\\\", "/"));`);
  L.push(`  }`);
  L.push(`  return out;`);
  L.push(`}`);
  L.push(`function globFiles(glob) {`);
  L.push(`  const re = globToRegExp(glob);`);
  L.push(`  return walk(ROOT).filter(file => re.test(file));`);
  L.push(`}`);
  L.push(`function normalizeRoutePath(routePath) {`);
  L.push(`  const normalized = String(routePath || "").replaceAll("\\\\", "/").trim();`);
  L.push(`  if (!normalized) return "/";`);
  L.push(`  const withSlash = normalized.startsWith("/") ? normalized : "/" + normalized;`);
  L.push(`  return withSlash.replace(/\\/+/g, "/").replace(/\\/$/, "") || "/";`);
  L.push(`}`);
  L.push(`function routePathFromFile(file) {`);
  L.push(`  const normalized = String(file || "").replaceAll("\\\\", "/");`);
  L.push(`  let match = normalized.match(/^app\\/api\\/(.+)\\/route\\.[^.]+$/);`);
  L.push(`  if (match) return normalizeRoutePath("/api/" + match[1]);`);
  L.push(`  match = normalized.match(/^pages\\/api\\/(.+)\\.[^.]+$/);`);
  L.push(`  if (match) {`);
  L.push(`    const suffix = match[1].replace(/\\/index$/, "");`);
  L.push(`    return normalizeRoutePath("/api/" + suffix);`);
  L.push(`  }`);
  L.push(`  return null;`);
  L.push(`}`);
  L.push(`function detectDeclaredHttpRoutes(glob) {`);
  L.push(`  const routes = [];`);
  L.push(`  const files = globFiles(glob);`);
  L.push(`  for (const file of files) {`);
  L.push(`    const content = readText(file);`);
  L.push(`    function pushRoute(method, routePath) {`);
  L.push(`      routes.push({ file, method: method.toUpperCase(), path: normalizeRoutePath(routePath) });`);
  L.push(`    }`);
  L.push(`    function methodsNear(index) {`);
  L.push(`      const window = content.slice(index, index + 800);`);
  L.push(`      return [...new Set([`);
  L.push(`        ...[...window.matchAll(/(?:req|request)\\.method\\s*===\\s*["'\`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'\`]/g)].map(match => match[1].toUpperCase()),`);
  L.push(`        ...[...window.matchAll(/\\bmethod\\s*===\\s*["'\`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'\`]/g)].map(match => match[1].toUpperCase()),`);
  L.push(`      ])];`);
  L.push(`    }`);
  L.push(`    function routePrefixFromRegexLiteral(literal) {`);
  L.push(`      const normalized = String(literal || "").replace(/^\\/\\^/, "").replace(/\\/[a-z]*$/, "").replaceAll("\\\\/", "/");`);
  L.push(`      const prefix = normalized.split(/[\\(\\[\\.\\+\\*\\?\\|]/)[0];`);
  L.push(`      if (!prefix.startsWith("/")) return null;`);
  L.push(`      return normalizeRoutePath(prefix);`);
  L.push(`    }`);
  L.push(`    for (const match of content.matchAll(/\\b(?:app|router|server|fastify)\\.(get|post|put|patch|delete|options|head|all)\\(\\s*["'\` ]([^"'\`]+)["'\`]/gi)) {`);
  L.push(`      const method = match[1].toUpperCase() === "ALL" ? "ANY" : match[1].toUpperCase();`);
  L.push(`      routes.push({ file, method, path: normalizeRoutePath(match[2]) });`);
  L.push(`    }`);
  L.push(`    for (const match of content.matchAll(/(?:pathname|url\\.pathname|path)\\s*===\\s*["'\`]([^"'\`]+)["'\`]\\s*&&\\s*(?:req|request)\\.method\\s*===\\s*["'\`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'\`]/g)) {`);
  L.push(`      routes.push({ file, method: match[2].toUpperCase(), path: normalizeRoutePath(match[1]) });`);
  L.push(`    }`);
  L.push(`    for (const match of content.matchAll(/(?:req|request)\\.method\\s*===\\s*["'\`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'\`]\\s*&&\\s*(?:pathname|url\\.pathname|path)\\s*===\\s*["'\`]([^"'\`]+)["'\`]/g)) {`);
  L.push(`      routes.push({ file, method: match[1].toUpperCase(), path: normalizeRoutePath(match[2]) });`);
  L.push(`    }`);
  L.push(`    for (const match of content.matchAll(/(?:pathname|url\\.pathname|path)\\s*===\\s*["'\`]([^"'\`]+)["'\`]\\s*&&\\s*method\\s*===\\s*["'\`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'\`]/g)) {`);
  L.push(`      routes.push({ file, method: match[2].toUpperCase(), path: normalizeRoutePath(match[1]) });`);
  L.push(`    }`);
  L.push(`    for (const match of content.matchAll(/method\\s*===\\s*["'\`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'\`]\\s*&&\\s*(?:pathname|url\\.pathname|path)\\s*===\\s*["'\`]([^"'\`]+)["'\`]/g)) {`);
  L.push(`      routes.push({ file, method: match[1].toUpperCase(), path: normalizeRoutePath(match[2]) });`);
  L.push(`    }`);
  L.push(`    for (const match of content.matchAll(/(?:pathname|url\\.pathname|path)\\s*===\\s*["'\`]([^"'\`]+)["'\`]/g)) {`);
  L.push(`      for (const method of methodsNear(match.index)) pushRoute(method, match[1]);`);
  L.push(`    }`);
  L.push(`    for (const match of content.matchAll(/(?:pathname|url\\.pathname|path)\\.match\\(\\s*(\\/\\^[^\\n]+?\\/[gimuy]*)\\s*\\)/g)) {`);
  L.push(`      const routePath = routePrefixFromRegexLiteral(match[1]);`);
  L.push(`      if (!routePath) continue;`);
  L.push(`      for (const method of methodsNear(match.index)) pushRoute(method, routePath);`);
  L.push(`    }`);
  L.push(`    const nextRoute = routePathFromFile(file);`);
  L.push(`    if (nextRoute) {`);
  L.push(`      const methods = [...content.matchAll(/export\\s+(?:async\\s+)?function\\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\\b/g)].map(match => match[1].toUpperCase());`);
  L.push(`      if (methods.length === 0) routes.push({ file, method: "ANY", path: nextRoute });`);
  L.push(`      else for (const method of [...new Set(methods)]) routes.push({ file, method, path: nextRoute });`);
  L.push(`    }`);
  L.push(`  }`);
  L.push(`  return routes;`);
  L.push(`}`);
  L.push(`function routeAllowed(routePath, allowPaths) {`);
  L.push(`  return (allowPaths || []).some(pattern => {`);
  L.push(`    const normalized = normalizeRoutePath(pattern);`);
  L.push(`    if (normalized.endsWith("*")) return routePath.startsWith(normalized.slice(0, -1));`);
  L.push(`    return routePath === normalized;`);
  L.push(`  });`);
  L.push(`}`);
  L.push(`function graphqlEndpointCandidates(endpoint) {`);
  L.push(`  const primary = normalizeRoutePath(endpoint || "/graphql");`);
  L.push(`  const candidates = new Set([primary]);`);
  L.push(`  if (!primary.startsWith("/api/")) candidates.add(normalizeRoutePath("/api" + primary));`);
  L.push(`  if (primary.startsWith("/api/")) candidates.add(normalizeRoutePath(primary.replace(/^\\/api/, "")));`);
  L.push(`  return [...candidates];`);
  L.push(`}`);
  L.push(`function hasGraphqlIndicators(content) {`);
  L.push(`  const patterns = [`);
  L.push(`    /@apollo\\/server/i,`);
  L.push(`    /apollo-server/i,`);
  L.push(`    /graphql-yoga/i,`);
  L.push(`    /mercurius/i,`);
  L.push(`    /type-graphql/i,`);
  L.push(`    /graphqlHTTP/i,`);
  L.push(`    /ApolloServer\\b/,`);
  L.push(`    /createYoga\\b/,`);
  L.push(`    /buildSchema\\b/,`);
  L.push(`    /makeExecutableSchema\\b/,`);
  L.push(`    /GraphQLSchema\\b/,`);
  L.push(`    /typeDefs\\b/,`);
  L.push(`  ];`);
  L.push(`  return patterns.some(pattern => pattern.test(content));`);
  L.push(`}`);
  L.push(`function assertGraphqlSurfacePresent(config) {`);
  L.push(`  const files = globFiles(config.files || "src/**/*");`);
  L.push(`  const endpointCandidates = graphqlEndpointCandidates(config.endpoint);`);
  L.push(`  const graphqlFiles = files.filter(file => hasGraphqlIndicators(readText(file)));`);
  L.push(`  assertCondition(graphqlFiles.length > 0, "Expected GraphQL server indicators in " + (config.files || "src/**/*"));`);
  L.push(`  const routes = detectDeclaredHttpRoutes(config.files || "src/**/*");`);
  L.push(`  const routeMatch = routes.find(route => endpointCandidates.includes(route.path));`);
  L.push(`  const endpointMention = graphqlFiles.some(file => endpointCandidates.some(candidate => readText(file).includes(candidate)));`);
  L.push(`  assertCondition(Boolean(routeMatch) || endpointMention, "Expected GraphQL endpoint " + endpointCandidates.join(" or ") + " to be declared.");`);
  L.push(`  if (config.require_schema) {`);
  L.push(`    const schemaFound = (config.schema_globs || []).some(glob => globFiles(glob).length > 0);`);
  L.push(`    assertCondition(schemaFound, "Expected GraphQL schema files matching: " + (config.schema_globs || []).join(", "));`);
  L.push(`  }`);
  L.push(`}`);
  L.push(`function assertGraphqlSurfaceAbsent(config) {`);
  L.push(`  const files = globFiles(config.files || "src/**/*");`);
  L.push(`  const endpointCandidates = graphqlEndpointCandidates(config.endpoint);`);
  L.push(`  const graphqlFiles = files.filter(file => hasGraphqlIndicators(readText(file)));`);
  L.push(`  const routes = detectDeclaredHttpRoutes(config.files || "src/**/*");`);
  L.push(`  const routeMatch = routes.find(route => endpointCandidates.includes(route.path));`);
  L.push(`  const endpointMention = graphqlFiles.some(file => endpointCandidates.some(candidate => readText(file).includes(candidate)));`);
  L.push(`  assertCondition(graphqlFiles.length === 0 && !routeMatch && !endpointMention, "Expected no GraphQL surface for " + endpointCandidates.join(" or "));`);
  L.push(`}`);
  L.push(`function routeMatchesMethod(routeMethod, methods) {`);
  L.push(`  if (!methods || methods.length === 0) return true;`);
  L.push(`  if (routeMethod === "ANY") return true;`);
  L.push(`  return methods.includes(routeMethod) || methods.includes("ANY");`);
  L.push(`}`);
  L.push(`function restRoutesMatching(config) {`);
  L.push(`  const routes = detectDeclaredHttpRoutes(config.files || "src/**/*");`);
  L.push(`  const prefix = normalizeRoutePath(config.path_prefix || "/api/");`);
  L.push(`  const methods = Array.isArray(config.methods) && config.methods.length > 0 ? config.methods : null;`);
  L.push(`  return routes.filter(route => route.path.startsWith(prefix) && routeMatchesMethod(route.method, methods) && !routeAllowed(route.path, config.allow_paths || []));`);
  L.push(`}`);
  L.push(`function assertRestApiPresent(config) {`);
  L.push(`  const matches = restRoutesMatching(config);`);
  L.push(`  const methodsLabel = Array.isArray(config.methods) && config.methods.length > 0 ? config.methods.join(", ") : "any method";`);
  L.push(`  assertCondition(matches.length > 0, "Expected REST API routes under " + normalizeRoutePath(config.path_prefix || "/api/") + " for " + methodsLabel);`);
  L.push(`}`);
  L.push(`function assertRestApiAbsent(config) {`);
  L.push(`  const matches = restRoutesMatching(config);`);
  L.push(`  assertCondition(matches.length === 0, "Expected no REST API routes under " + normalizeRoutePath(config.path_prefix || "/api/") + ", but found: " + matches.map(route => route.method + " " + route.path + " [" + route.file + "]").join(", "));`);
  L.push(`}`);
  L.push(`function parseImports(content) {`);
  L.push(`  const imports = [];`);
  L.push(`  for (const match of content.matchAll(/import\\s+(?:[^"'` + "`" + `]+?\\s+from\\s+)?["'` + "`" + `]([^"'` + "`" + `]+)["'` + "`" + `]/g)) imports.push(match[1]);`);
  L.push(`  for (const match of content.matchAll(/export\\s+[^"'` + "`" + `]*?from\\s+["'` + "`" + `]([^"'` + "`" + `]+)["'` + "`" + `]/g)) imports.push(match[1]);`);
  L.push(`  for (const match of content.matchAll(/require\\(\\s*["'` + "`" + `]([^"'` + "`" + `]+)["'` + "`" + `]\\s*\\)/g)) imports.push(match[1]);`);
  L.push(`  for (const match of content.matchAll(/import\\(\\s*["'` + "`" + `]([^"'` + "`" + `]+)["'` + "`" + `]\\s*\\)/g)) imports.push(match[1]);`);
  L.push(`  return imports;`);
  L.push(`}`);
  L.push(`function resolveRelativeImport(fromFile, specifier) {`);
  L.push(`  const base = path.dirname(repoPath(fromFile));`);
  L.push(`  const candidates = [specifier, specifier + ".js", specifier + ".ts", specifier + ".tsx", specifier + ".jsx", specifier + ".mjs", specifier + ".cjs", path.join(specifier, "index.js"), path.join(specifier, "index.ts"), path.join(specifier, "index.tsx"), path.join(specifier, "index.mjs"), path.join(specifier, "index.cjs")];`);
  L.push(`  for (const candidate of candidates) {`);
  L.push(`    const full = path.resolve(base, candidate);`);
  L.push(`    if (fs.existsSync(full)) return path.relative(ROOT, full).replaceAll("\\\\", "/");`);
  L.push(`  }`);
  L.push(`  return path.relative(ROOT, path.resolve(base, specifier)).replaceAll("\\\\", "/");`);
  L.push(`}`);
  L.push(`function assertForbiddenImports(glob, patterns) {`);
  L.push(`  const files = globFiles(glob);`);
  L.push(`  for (const file of files) {`);
  L.push(`    const imports = parseImports(readText(file));`);
  L.push(`    for (const pattern of patterns) {`);
  L.push(`      const violated = imports.some(specifier => specifier === pattern || specifier.startsWith(pattern.replace(/\\*\\*$/, ""))) || readText(file).includes(pattern);`);
  L.push(`      assertCondition(!violated, file + " should not import or reference " + pattern);`);
  L.push(`    }`);
  L.push(`  }`);
  L.push(`}`);
  L.push(`function assertAllowedImports(glob, patterns, allowRelative) {`);
  L.push(`  const files = globFiles(glob);`);
  L.push(`  for (const file of files) {`);
  L.push(`    const imports = parseImports(readText(file));`);
  L.push(`    for (const specifier of imports) {`);
  L.push(`      if (allowRelative && (specifier.startsWith("./") || specifier.startsWith("../"))) continue;`);
  L.push(`      const ok = patterns.some(pattern => specifier === pattern || specifier.startsWith(pattern.replace(/\\*\\*$/, "")));`);
  L.push(`      assertCondition(ok, file + " imports disallowed module " + specifier);`);
  L.push(`    }`);
  L.push(`  }`);
  L.push(`}`);
  L.push(`function assertLayerDependencies(config) {`);
  L.push(`  const layers = config.layers.map(layer => ({ ...layer, filesMatched: globFiles(layer.files) }));`);
  L.push(`  function layerForFile(file) { return layers.find(layer => layer.filesMatched.includes(file)); }`);
  L.push(`  for (const layer of layers) {`);
  L.push(`    for (const file of layer.filesMatched) {`);
  L.push(`      for (const specifier of parseImports(readText(file))) {`);
  L.push(`        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {`);
  L.push(`          if (!config.allow_external) assertCondition(false, file + " imports external module " + specifier);`);
  L.push(`          continue;`);
  L.push(`        }`);
  L.push(`        const targetFile = resolveRelativeImport(file, specifier);`);
  L.push(`        const targetLayer = layerForFile(targetFile);`);
  L.push(`        if (!targetLayer) {`);
  L.push(`          if (!config.allow_unmatched_relative) assertCondition(false, file + " imports unmatched relative path " + specifier);`);
  L.push(`          continue;`);
  L.push(`        }`);
  L.push(`        if (config.allow_same_layer && targetLayer.name === layer.name) continue;`);
  L.push(`        assertCondition(layer.may_import.includes(targetLayer.name), file + " (" + layer.name + ") must not import " + targetLayer.name + " via " + specifier);`);
  L.push(`      }`);
  L.push(`    }`);
  L.push(`  }`);
  L.push(`}`);
  L.push(`function assertNoCircularDependencies(glob) {`);
  L.push(`  const files = globFiles(glob);`);
  L.push(`  const graph = new Map();`);
  L.push(`  for (const file of files) {`);
  L.push(`    const edges = [];`);
  L.push(`    for (const specifier of parseImports(readText(file))) {`);
  L.push(`      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;`);
  L.push(`      const target = resolveRelativeImport(file, specifier);`);
  L.push(`      if (files.includes(target)) edges.push(target);`);
  L.push(`    }`);
  L.push(`    graph.set(file, edges);`);
  L.push(`  }`);
  L.push(`  const visited = new Set();`);
  L.push(`  const stack = new Set();`);
  L.push(`  const pathStack = [];`);
  L.push(`  function visit(node) {`);
  L.push(`    if (stack.has(node)) {`);
  L.push(`      const cycleStart = pathStack.indexOf(node);`);
  L.push(`      const cycle = pathStack.slice(cycleStart).concat(node);`);
  L.push(`      throw new Error("Circular dependency detected: " + cycle.join(" -> "));`);
  L.push(`    }`);
  L.push(`    if (visited.has(node)) return;`);
  L.push(`    visited.add(node);`);
  L.push(`    stack.add(node);`);
  L.push(`    pathStack.push(node);`);
  L.push(`    for (const next of graph.get(node) || []) visit(next);`);
  L.push(`    pathStack.pop();`);
  L.push(`    stack.delete(node);`);
  L.push(`  }`);
  L.push(`  for (const file of graph.keys()) visit(file);`);
  L.push(`}`);
  L.push(`function runCommand(command, relCwd) {`);
  L.push(`  const cwd = relCwd ? repoPath(relCwd) : ROOT;`);
  L.push(`  try {`);
  L.push(`    const stdout = spawnSync("bash", ["-lc", command], { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });`);
  L.push(`    return { ok: stdout.status === 0, stdout: (stdout.stdout || "") + (stdout.stderr || ""), exit_code: stdout.status ?? 1 };`);
  L.push(`  } catch (err) {`);
  L.push(`    return { ok: false, stdout: String(err.message || err), exit_code: 1 };`);
  L.push(`  }`);
  L.push(`}`);
  L.push(`async function runDependencyCruiser(backend) {`);
  L.push(`  if (!backend.rules || backend.rules.length === 0) return;`);
  L.push(`  const args = ["depcruise", "--output-type", "err-long", "--config", artifactPath(backend.config_file), ...backend.targets];`);
  L.push(`  const res = spawnSync("npx", args, { cwd: ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });`);
  L.push(`  const output = (res.stdout || "") + (res.stderr || "");`);
  L.push(`  if (res.status !== 0) throw new Error("dependency-cruiser reported violations\\n" + output.trim());`);
  L.push(`}`);
  L.push(`async function runMadge(backend) {`);
  L.push(`  if (!backend.rules || backend.rules.length === 0) return;`);
  L.push(`  const { default: madge } = await import("madge");`);
  L.push(`  for (const rule of backend.rules) {`);
  L.push(`    const result = await madge(repoPath(rule.base), { fileExtensions: rule.extensions, tsConfig: rule.tsconfig ? repoPath(rule.tsconfig) : undefined });`);
  L.push(`    const cycles = result.circular();`);
  L.push(`    if (cycles.length > 0) throw new Error("madge detected circular dependencies under " + rule.base + "\\n" + JSON.stringify(cycles, null, 2));`);
  L.push(`  }`);
  L.push(`}`);
  L.push(`async function runTsarch(backend) {`);
  L.push(`  if (!backend.rules || backend.rules.length === 0) return;`);
  L.push(`  const { filesOfProject } = await import("tsarch");`);
  L.push(`  const violations = [];`);
  L.push(`  for (const rule of backend.rules) {`);
  L.push(`    if (rule.kind === "forbidden-import") {`);
  L.push(`      for (const pattern of rule.patterns) {`);
  L.push(`        const res = await filesOfProject().matchingPattern(rule.files).shouldNot().dependOnFiles().matchingPattern(pattern).check();`);
  L.push(`        if (Array.isArray(res) && res.length > 0) violations.push("tsarch forbidden import violation from " + rule.files + " to " + pattern + "\\n" + JSON.stringify(res, null, 2));`);
  L.push(`      }`);
  L.push(`    }`);
  L.push(`    if (rule.kind === "layer-dependencies") {`);
  L.push(`      const layers = rule.config.layers || [];`);
  L.push(`      for (const layer of layers) {`);
  L.push(`        for (const target of layers) {`);
  L.push(`          if (target.name === layer.name && rule.config.allow_same_layer !== false) continue;`);
  L.push(`          if (target.name !== layer.name && layer.may_import.includes(target.name)) continue;`);
  L.push(`          const res = await filesOfProject().matchingPattern(layer.files).shouldNot().dependOnFiles().matchingPattern(target.files).check();`);
  L.push(`          if (Array.isArray(res) && res.length > 0) violations.push("tsarch layer dependency violation from " + layer.name + " to " + target.name + "\\n" + JSON.stringify(res, null, 2));`);
  L.push(`        }`);
  L.push(`      }`);
  L.push(`    }`);
  L.push(`    if (rule.kind === "no-circular-dependencies") {`);
  L.push(`      const res = await filesOfProject().matchingPattern(rule.files).should().beFreeOfCycles().check();`);
  L.push(`      if (Array.isArray(res) && res.length > 0) violations.push("tsarch circular dependency violation in " + rule.files + "\\n" + JSON.stringify(res, null, 2));`);
  L.push(`    }`);
  L.push(`  }`);
  L.push(`  if (violations.length > 0) throw new Error(violations.join("\\n\\n"));`);
  L.push(`}`);
  L.push(`async function runEslintBoundaries(backend) {`);
  L.push(`  if (!backend.config_file) return;`);
  L.push(`  if (backend.needs_typescript_parser) {`);
  L.push(`    try {`);
  L.push(`      await import("@typescript-eslint/parser");`);
  L.push(`    } catch {`);
  L.push(`      throw new Error("eslint-plugin-boundaries backend needs @typescript-eslint/parser for TypeScript patterns.");`);
  L.push(`    }`);
  L.push(`  }`);
  L.push(`  const baseArgs = ["eslint", "--format", "json", "--config", artifactPath(backend.config_file), ...backend.targets];`);
  L.push(`  let res = spawnSync("npx", ["--yes", "eslint", "--no-config-lookup", ...baseArgs.slice(1)], { cwd: ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });`);
  L.push(`  let output = (res.stdout || "") + (res.stderr || "");`);
  L.push(`  if (/Unknown option ['"]--no-config-lookup['"]/.test(output)) {`);
  L.push(`    res = spawnSync("npx", ["--yes", "eslint", "--no-eslintrc", ...baseArgs.slice(1)], { cwd: ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });`);
  L.push(`    output = (res.stdout || "") + (res.stderr || "");`);
  L.push(`  }`);
  L.push(`  if (res.status !== 0) throw new Error("eslint-plugin-boundaries reported violations\\n" + output.trim());`);
  L.push(`}`);
  L.push(`async function runFrameworkBackend(backend) {`);
  L.push(`  if (!backend || !backend.framework || backend.framework === "custom" || backend.framework === "archtest") return;`);
  L.push(`  if (backend.framework === "dependency-cruiser") return runDependencyCruiser(backend);`);
  L.push(`  if (backend.framework === "madge") return runMadge(backend);`);
  L.push(`  if (backend.framework === "tsarch") return runTsarch(backend);`);
  L.push(`  if (backend.framework === "eslint-plugin-boundaries") return runEslintBoundaries(backend);`);
  L.push(`}`);
  L.push(`function runGenericAssertions(assertions) {`);
  L.push(`  for (const assertion of assertions || []) {`);
  L.push(`    if (assertion.path_exists) { assertCondition(exists(assertion.path_exists.path), "Expected path to exist: " + assertion.path_exists.path); continue; }`);
  L.push(`    if (assertion.path_absent) { assertCondition(!exists(assertion.path_absent.path), "Expected path to be absent: " + assertion.path_absent.path); continue; }`);
  L.push(`    if (assertion.file_contains) { assertCondition(readText(assertion.file_contains.path).includes(assertion.file_contains.text), "Expected " + assertion.file_contains.path + " to contain " + assertion.file_contains.text); continue; }`);
  L.push(`    if (assertion.file_not_contains) { assertCondition(!readText(assertion.file_not_contains.path).includes(assertion.file_not_contains.text), "Expected " + assertion.file_not_contains.path + " not to contain " + assertion.file_not_contains.text); continue; }`);
  L.push(`    if (assertion.json_has) { assertCondition(jsonQuery(assertion.json_has.path, assertion.json_has.query) !== undefined, "Expected " + assertion.json_has.path + " " + assertion.json_has.query + " to be defined"); continue; }`);
  L.push(`    if (assertion.json_equals) { assertDeepEqual(jsonQuery(assertion.json_equals.path, assertion.json_equals.query), assertion.json_equals.equals, "Expected " + assertion.json_equals.path + " " + assertion.json_equals.query + " to equal " + JSON.stringify(assertion.json_equals.equals)); continue; }`);
  L.push(`    if (assertion.json_matches) { assertMatches(jsonQuery(assertion.json_matches.path, assertion.json_matches.query), assertion.json_matches.matches, "Expected " + assertion.json_matches.path + " " + assertion.json_matches.query + " to match " + assertion.json_matches.matches); continue; }`);
  L.push(`    if (assertion.dependency_present) {`);
  L.push(`      const section = assertion.dependency_present.section === "all" ? undefined : assertion.dependency_present.section;`);
  L.push(`      assertCondition(hasDependency(assertion.dependency_present.path, assertion.dependency_present.name, section), "Expected dependency " + assertion.dependency_present.name + " to be declared in " + assertion.dependency_present.path);`);
  L.push(`      continue;`);
  L.push(`    }`);
  L.push(`    if (assertion.dependency_absent) {`);
  L.push(`      const section = assertion.dependency_absent.section === "all" ? undefined : assertion.dependency_absent.section;`);
  L.push(`      assertCondition(!hasDependency(assertion.dependency_absent.path, assertion.dependency_absent.name, section), "Expected dependency " + assertion.dependency_absent.name + " to be absent from " + assertion.dependency_absent.path);`);
  L.push(`      continue;`);
  L.push(`    }`);
  L.push(`    if (assertion.dependency_version_matches) {`);
  L.push(`      const section = assertion.dependency_version_matches.section === "all" ? undefined : assertion.dependency_version_matches.section;`);
  L.push(`      assertMatches(dependencyVersion(assertion.dependency_version_matches.path, assertion.dependency_version_matches.name, section), assertion.dependency_version_matches.matches, "Expected dependency " + assertion.dependency_version_matches.name + " version in " + assertion.dependency_version_matches.path + " to match " + assertion.dependency_version_matches.matches);`);
  L.push(`      continue;`);
  L.push(`    }`);
  L.push(`    if (assertion.script_present) { assertCondition(packageScript(assertion.script_present.path, assertion.script_present.name) !== undefined, "Expected script " + assertion.script_present.name + " to exist in " + assertion.script_present.path); continue; }`);
  L.push(`    if (assertion.script_contains) { assertCondition(String(packageScript(assertion.script_contains.path, assertion.script_contains.name) || "").includes(assertion.script_contains.text), "Expected script " + assertion.script_contains.name + " in " + assertion.script_contains.path + " to contain " + assertion.script_contains.text); continue; }`);
  L.push(`    if (assertion.github_action_uses) { assertCondition(readText(assertion.github_action_uses.workflow).includes(assertion.github_action_uses.action), "Expected " + assertion.github_action_uses.workflow + " to use " + assertion.github_action_uses.action); continue; }`);
  L.push(`    if (assertion.glob_count) { assertCondition(globFiles(assertion.glob_count.glob).length === assertion.glob_count.equals, "Expected " + assertion.glob_count.glob + " to match " + assertion.glob_count.equals + " file(s)"); continue; }`);
  L.push(`    if (assertion.glob_count_gte) { assertCondition(globFiles(assertion.glob_count_gte.glob).length >= assertion.glob_count_gte.gte, "Expected " + assertion.glob_count_gte.glob + " to match at least " + assertion.glob_count_gte.gte + " file(s)"); continue; }`);
  L.push(`    if (assertion.graphql_surface_present) { assertGraphqlSurfacePresent(assertion.graphql_surface_present); continue; }`);
  L.push(`    if (assertion.graphql_surface_absent) { assertGraphqlSurfaceAbsent(assertion.graphql_surface_absent); continue; }`);
  L.push(`    if (assertion.rest_api_present) { assertRestApiPresent(assertion.rest_api_present); continue; }`);
  L.push(`    if (assertion.rest_api_absent) { assertRestApiAbsent(assertion.rest_api_absent); continue; }`);
  L.push(`    if (assertion.imports_forbidden) { assertForbiddenImports(assertion.imports_forbidden.files, assertion.imports_forbidden.patterns); continue; }`);
  L.push(`    if (assertion.imports_allowed_only_from) { assertAllowedImports(assertion.imports_allowed_only_from.files, assertion.imports_allowed_only_from.patterns, assertion.imports_allowed_only_from.allow_relative); continue; }`);
  L.push(`    if (assertion.layer_dependencies) { assertLayerDependencies(assertion.layer_dependencies); continue; }`);
  L.push(`    if (assertion.no_circular_dependencies) { assertNoCircularDependencies(assertion.no_circular_dependencies.files); continue; }`);
  L.push(`    if (assertion.command_succeeds) { const res = runCommand(assertion.command_succeeds.command, assertion.command_succeeds.cwd); assertCondition(res.ok, "Expected command to succeed: " + assertion.command_succeeds.command + "\\n" + res.stdout); continue; }`);
  L.push(`    if (assertion.command_stdout_contains) { const res = runCommand(assertion.command_stdout_contains.command, assertion.command_stdout_contains.cwd); assertCondition(res.stdout.includes(assertion.command_stdout_contains.text), "Expected command output to contain " + assertion.command_stdout_contains.text + "\\n" + res.stdout); continue; }`);
  L.push(`    if (assertion.command_stdout_not_contains) { const res = runCommand(assertion.command_stdout_not_contains.command, assertion.command_stdout_not_contains.cwd); assertCondition(!res.stdout.includes(assertion.command_stdout_not_contains.text), "Expected command output not to contain " + assertion.command_stdout_not_contains.text + "\\n" + res.stdout); continue; }`);
  L.push(`    throw new Error("Unknown technical assertion shape: " + JSON.stringify(assertion));`);
  L.push(`  }`);
  L.push(`}`);
  L.push(`async function main() {`);
  L.push(`  assertCondition(!exists("__shipflow_false_positive__/missing"), "False positive guard failed");`);
  L.push(`  assertCondition(globFiles("__shipflow_false_positive__/**").length === 0, "False positive guard glob should be empty");`);
  L.push(`  if (exists("package.json")) assertCondition(!hasDependency("package.json", "__shipflow_false_positive__"), "False positive guard dependency should be absent");`);
  L.push(`  await runFrameworkBackend(SPEC.backend);`);
  L.push(`  runGenericAssertions(SPEC.generic_assertions);`);
  L.push(`  console.log("[ShipFlow technical] PASS " + SPEC.id + " [" + ${JSON.stringify(runnerLabel)} + "]");`);
  L.push(`}`);
  L.push(``);
  L.push(`main().catch(error => {`);
  L.push(`  console.error("[ShipFlow technical] FAIL " + SPEC.id + ": " + (error && error.stack ? error.stack : error));`);
  L.push(`  process.exit(1);`);
  L.push(`});`);
  L.push(``);
  return L.join("\n");
}

export function genTechnicalArtifacts(check) {
  const baseName = technicalBaseName(check);
  const runnerName = `${baseName}.runner.mjs`;
  const { backend, artifacts, genericAssertions } = buildTechnicalBackend(check, runnerName);
  return [
    {
      name: runnerName,
      content: genTechnicalRunner(check, backend, genericAssertions),
      kind: "technical-runner",
      primary: true,
    },
    ...artifacts,
  ];
}
