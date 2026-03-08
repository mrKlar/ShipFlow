import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { TechnicalCheck } from "./schema/technical-check.zod.js";

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

export function technicalAssertExpr(a, root) {
  if (a.path_exists) {
    return `expect(exists(${JSON.stringify(a.path_exists.path)})).toBe(true);`;
  }
  if (a.path_absent) {
    return `expect(exists(${JSON.stringify(a.path_absent.path)})).toBe(false);`;
  }
  if (a.file_contains) {
    return `expect(readText(${JSON.stringify(a.file_contains.path)})).toContain(${JSON.stringify(a.file_contains.text)});`;
  }
  if (a.file_not_contains) {
    return `expect(readText(${JSON.stringify(a.file_not_contains.path)})).not.toContain(${JSON.stringify(a.file_not_contains.text)});`;
  }
  if (a.json_has) {
    return `expect(${jsExprFromQuery(a.json_has.query, `readJson(${JSON.stringify(a.json_has.path)})`)}).not.toBeUndefined();`;
  }
  if (a.json_equals) {
    return `expect(${jsExprFromQuery(a.json_equals.query, `readJson(${JSON.stringify(a.json_equals.path)})`)}).toEqual(${JSON.stringify(a.json_equals.equals)});`;
  }
  if (a.dependency_present) {
    const sectionExpr = a.dependency_present.section === "all"
      ? `hasDependency(${JSON.stringify(a.dependency_present.path)}, ${JSON.stringify(a.dependency_present.name)})`
      : `hasDependency(${JSON.stringify(a.dependency_present.path)}, ${JSON.stringify(a.dependency_present.name)}, ${JSON.stringify(a.dependency_present.section)})`;
    return `expect(${sectionExpr}).toBe(true);`;
  }
  if (a.dependency_absent) {
    const sectionExpr = a.dependency_absent.section === "all"
      ? `hasDependency(${JSON.stringify(a.dependency_absent.path)}, ${JSON.stringify(a.dependency_absent.name)})`
      : `hasDependency(${JSON.stringify(a.dependency_absent.path)}, ${JSON.stringify(a.dependency_absent.name)}, ${JSON.stringify(a.dependency_absent.section)})`;
    return `expect(${sectionExpr}).toBe(false);`;
  }
  if (a.github_action_uses) {
    const { workflow, action } = a.github_action_uses;
    return `expect(readText(${JSON.stringify(workflow)})).toContain(${JSON.stringify(action)});`;
  }
  if (a.glob_count) {
    return `expect(globFiles(${JSON.stringify(a.glob_count.glob)}).length).toBe(${a.glob_count.equals});`;
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
  if (a.command_succeeds) {
    const cwd = a.command_succeeds.cwd ? JSON.stringify(a.command_succeeds.cwd) : "undefined";
    return `expect(runCommand(${JSON.stringify(a.command_succeeds.command)}, ${cwd}).ok).toBe(true);`;
  }
  if (a.command_stdout_contains) {
    const cwd = a.command_stdout_contains.cwd ? JSON.stringify(a.command_stdout_contains.cwd) : "undefined";
    return `expect(runCommand(${JSON.stringify(a.command_stdout_contains.command)}, ${cwd}).stdout).toContain(${JSON.stringify(a.command_stdout_contains.text)});`;
  }
  if (a.command_stdout_not_contains) {
    const cwd = a.command_stdout_not_contains.cwd ? JSON.stringify(a.command_stdout_not_contains.cwd) : "undefined";
    return `expect(runCommand(${JSON.stringify(a.command_stdout_not_contains.command)}, ${cwd}).stdout).not.toContain(${JSON.stringify(a.command_stdout_not_contains.text)});`;
  }
  throw new Error("Unknown technical assert");
}

export function genTechnicalTest(check) {
  const root = check.app.root || ".";
  const runnerLabel = check.runner?.framework || check.runner?.kind || "custom";
  const L = [];

  L.push(`import { test, expect } from "@playwright/test";`);
  L.push(`import { execSync } from "node:child_process";`);
  L.push(`import fs from "node:fs";`);
  L.push(`import path from "node:path";`);
  L.push(``);
  L.push(`const ROOT = path.resolve(process.cwd(), ${JSON.stringify(root)});`);
  L.push(``);
  L.push(`function repoPath(rel) { return path.resolve(ROOT, rel); }`);
  L.push(`function exists(rel) { return fs.existsSync(repoPath(rel)); }`);
  L.push(`function readText(rel) { return fs.readFileSync(repoPath(rel), "utf-8"); }`);
  L.push(`function readJson(rel) { return JSON.parse(readText(rel)); }`);
  L.push(`function hasDependency(rel, name, section) {`);
  L.push(`  const pkg = readJson(rel);`);
  L.push(`  const sections = section ? [section] : ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];`);
  L.push(`  return sections.some(key => pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], name));`);
  L.push(`}`);
  L.push(`function globToRegExp(glob) {`);
  L.push('  const escaped = glob.replace(/[.+^${}()|[\\]\\\\]/g, "\\\\$&");');
  L.push(`  return new RegExp("^" + escaped.replace(/\\*\\*/g, "__DOUBLE_STAR__").replace(/\\*/g, "[^/]*").replace(/__DOUBLE_STAR__/g, ".*") + "$");`);
  L.push(`}`);
  L.push(`function walk(dir, out = []) {`);
  L.push(`  if (!fs.existsSync(dir)) return out;`);
  L.push(`  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {`);
  L.push(`    if (ent.name === ".git" || ent.name === "node_modules") continue;`);
  L.push(`    const full = path.join(dir, ent.name);`);
  L.push(`    if (ent.isDirectory()) walk(full, out); else out.push(path.relative(ROOT, full).replaceAll("\\\\", "/"));`);
  L.push(`  }`);
  L.push(`  return out;`);
  L.push(`}`);
  L.push(`function globFiles(glob) {`);
  L.push(`  const re = globToRegExp(glob);`);
  L.push(`  return walk(ROOT).filter(file => re.test(file));`);
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
  L.push(`  const candidates = [specifier, specifier + ".js", specifier + ".ts", specifier + ".tsx", specifier + ".jsx", path.join(specifier, "index.js"), path.join(specifier, "index.ts"), path.join(specifier, "index.tsx")];`);
  L.push(`  for (const candidate of candidates) {`);
  L.push(`    const full = path.resolve(base, candidate);`);
  L.push(`    if (fs.existsSync(full)) return path.relative(ROOT, full).replaceAll("\\\\", "/");`);
  L.push(`  }`);
  L.push(`  return path.relative(ROOT, path.resolve(base, specifier)).replaceAll("\\\\", "/");`);
  L.push(`}`);
  L.push(`function assertForbiddenImports(glob, patterns) {`);
  L.push(`  const files = globFiles(glob);`);
  L.push(`  for (const file of files) {`);
    L.push(`    const content = readText(file);`);
    L.push(`    for (const pattern of patterns) {`);
      L.push(`      expect(content.includes(pattern), file + " should not import or reference " + pattern).toBe(false);`);
    L.push(`    }`);
  L.push(`  }`);
  L.push(`}`);
  L.push(`function assertAllowedImports(glob, patterns, allowRelative) {`);
  L.push(`  const files = globFiles(glob);`);
  L.push(`  for (const file of files) {`);
  L.push(`    const imports = parseImports(readText(file));`);
  L.push(`    for (const specifier of imports) {`);
  L.push(`      if (allowRelative && (specifier.startsWith("./") || specifier.startsWith("../"))) continue;`);
  L.push(`      const ok = patterns.some(pattern => specifier === pattern || specifier.startsWith(pattern));`);
  L.push(`      expect(ok, file + " imports disallowed module " + specifier).toBe(true);`);
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
  L.push(`          if (!config.allow_external) expect(true, file + " imports external module " + specifier).toBe(false);`);
  L.push(`          continue;`);
  L.push(`        }`);
  L.push(`        const targetFile = resolveRelativeImport(file, specifier);`);
  L.push(`        const targetLayer = layerForFile(targetFile);`);
  L.push(`        if (!targetLayer) {`);
  L.push(`          if (!config.allow_unmatched_relative) expect(true, file + " imports unmatched relative path " + specifier).toBe(false);`);
  L.push(`          continue;`);
  L.push(`        }`);
  L.push(`        if (config.allow_same_layer && targetLayer.name === layer.name) continue;`);
  L.push(`        expect(layer.may_import.includes(targetLayer.name), file + " (" + layer.name + ") must not import " + targetLayer.name + " via " + specifier).toBe(true);`);
  L.push(`      }`);
  L.push(`    }`);
  L.push(`  }`);
  L.push(`}`);
  L.push(`function runCommand(command, relCwd) {`);
  L.push(`  const cwd = relCwd ? repoPath(relCwd) : ROOT;`);
  L.push(`  try {`);
  L.push(`    const stdout = execSync(command, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });`);
  L.push(`    return { ok: true, stdout: stdout || "" };`);
  L.push(`  } catch (err) {`);
  L.push(`    const stdout = (err.stdout?.toString() || "") + (err.stderr?.toString() || "");`);
  L.push(`    return { ok: false, stdout };`);
  L.push(`  }`);
  L.push(`}`);
  L.push(``);
  L.push(`test.describe(${JSON.stringify(`Technical: ${check.category}`)}, () => {`);
  L.push(`  test(${JSON.stringify(`${check.id}: ${check.title} [${runnerLabel}]`)}, async () => {`);
  L.push(`    // Anti false positive guard`);
  L.push(`    expect(exists("__shipflow_false_positive__/missing")).toBe(false);`);
  L.push(`    expect(globFiles("__shipflow_false_positive__/**").length).toBe(0);`);
  L.push(`    if (exists("package.json")) expect(hasDependency("package.json", "__shipflow_false_positive__")).toBe(false);`);
  for (const a of check.assert) {
    L.push(`    ${technicalAssertExpr(a, root)}`);
  }
  L.push(`  });`);
  L.push(`});`);
  L.push(``);

  return L.join("\n");
}
