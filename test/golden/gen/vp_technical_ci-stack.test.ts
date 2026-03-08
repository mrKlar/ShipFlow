import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), ".");

function repoPath(rel) { return path.resolve(ROOT, rel); }
function exists(rel) { return fs.existsSync(repoPath(rel)); }
function readText(rel) { return fs.readFileSync(repoPath(rel), "utf-8"); }
function readJson(rel) { return JSON.parse(readText(rel)); }
function hasDependency(rel, name, section) {
  const pkg = readJson(rel);
  const sections = section ? [section] : ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  return sections.some(key => pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], name));
}
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\*\*/g, "__DOUBLE_STAR__").replace(/\*/g, "[^/]*").replace(/__DOUBLE_STAR__/g, ".*") + "$");
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === "node_modules") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out); else out.push(path.relative(ROOT, full).replaceAll("\\", "/"));
  }
  return out;
}
function globFiles(glob) {
  const re = globToRegExp(glob);
  return walk(ROOT).filter(file => re.test(file));
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
  const candidates = [specifier, specifier + ".js", specifier + ".ts", specifier + ".tsx", specifier + ".jsx", path.join(specifier, "index.js"), path.join(specifier, "index.ts"), path.join(specifier, "index.tsx")];
  for (const candidate of candidates) {
    const full = path.resolve(base, candidate);
    if (fs.existsSync(full)) return path.relative(ROOT, full).replaceAll("\\", "/");
  }
  return path.relative(ROOT, path.resolve(base, specifier)).replaceAll("\\", "/");
}
function assertForbiddenImports(glob, patterns) {
  const files = globFiles(glob);
  for (const file of files) {
    const content = readText(file);
    for (const pattern of patterns) {
      expect(content.includes(pattern), file + " should not import or reference " + pattern).toBe(false);
    }
  }
}
function assertAllowedImports(glob, patterns, allowRelative) {
  const files = globFiles(glob);
  for (const file of files) {
    const imports = parseImports(readText(file));
    for (const specifier of imports) {
      if (allowRelative && (specifier.startsWith("./") || specifier.startsWith("../"))) continue;
      const ok = patterns.some(pattern => specifier === pattern || specifier.startsWith(pattern));
      expect(ok, file + " imports disallowed module " + specifier).toBe(true);
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
          if (!config.allow_external) expect(true, file + " imports external module " + specifier).toBe(false);
          continue;
        }
        const targetFile = resolveRelativeImport(file, specifier);
        const targetLayer = layerForFile(targetFile);
        if (!targetLayer) {
          if (!config.allow_unmatched_relative) expect(true, file + " imports unmatched relative path " + specifier).toBe(false);
          continue;
        }
        if (config.allow_same_layer && targetLayer.name === layer.name) continue;
        expect(layer.may_import.includes(targetLayer.name), file + " (" + layer.name + ") must not import " + targetLayer.name + " via " + specifier).toBe(true);
      }
    }
  }
}
function runCommand(command, relCwd) {
  const cwd = relCwd ? repoPath(relCwd) : ROOT;
  try {
    const stdout = execSync(command, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, stdout: stdout || "" };
  } catch (err) {
    const stdout = (err.stdout?.toString() || "") + (err.stderr?.toString() || "");
    return { ok: false, stdout };
  }
}

test.describe("Technical: ci", () => {
  test("technical-ci-stack: Repository uses GitHub Actions and Playwright [custom]", async () => {
    // Anti false positive guard
    expect(exists("__shipflow_false_positive__/missing")).toBe(false);
    expect(globFiles("__shipflow_false_positive__/**").length).toBe(0);
    if (exists("package.json")) expect(hasDependency("package.json", "__shipflow_false_positive__")).toBe(false);
    expect(exists("package.json")).toBe(true);
    expect(readText("package.json")).toContain("@playwright/test");
    expect(exists(".github/workflows/ci.yml")).toBe(true);
    expect(readText(".github/workflows/ci.yml")).toContain("actions/checkout@v4");
  });
});
