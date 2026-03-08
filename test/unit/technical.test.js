import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TechnicalCheck } from "../../lib/schema/technical-check.zod.js";
import { technicalAssertExpr, genTechnicalTest } from "../../lib/gen-technical.js";

const base = {
  id: "technical-ci",
  title: "Repository uses GitHub Actions for CI",
  severity: "blocker",
  category: "ci",
  app: { kind: "technical", root: "." },
};

describe("TechnicalCheck schema", () => {
  it("accepts a CI technical check", () => {
    const r = TechnicalCheck.parse({
      ...base,
      assert: [
        { path_exists: { path: ".github/workflows/ci.yml" } },
        { github_action_uses: { workflow: ".github/workflows/ci.yml", action: "actions/checkout@v4" } },
      ],
    });
    assert.equal(r.app.kind, "technical");
    assert.equal(r.category, "ci");
  });

  it("accepts architecture checks with archtest runner", () => {
    const r = TechnicalCheck.parse({
      ...base,
      category: "architecture",
      runner: { kind: "archtest", framework: "dependency-cruiser" },
      assert: [
        { imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/", "react"] } },
      ],
    });
    assert.equal(r.runner.kind, "archtest");
    assert.equal(r.runner.framework, "dependency-cruiser");
  });

  it("accepts richer architecture and command assertions", () => {
    const r = TechnicalCheck.parse({
      ...base,
      category: "architecture",
      runner: { kind: "archtest", framework: "madge" },
      assert: [
        { imports_allowed_only_from: { files: "src/domain/**/*.ts", patterns: ["@/domain", "@/shared"], allow_relative: true } },
        { layer_dependencies: {
          layers: [
            { name: "ui", files: "src/ui/**/*.ts", may_import: ["application", "shared"] },
            { name: "application", files: "src/application/**/*.ts", may_import: ["domain", "shared"] },
          ],
        } },
        { command_succeeds: { command: "echo ok" } },
      ],
    });
    assert.equal(r.assert.length, 3);
  });

  it("accepts tsarch as an architecture framework", () => {
    const r = TechnicalCheck.parse({
      ...base,
      category: "architecture",
      runner: { kind: "archtest", framework: "tsarch" },
      assert: [
        { command_succeeds: { command: "npx tsarch --help" } },
      ],
    });
    assert.equal(r.runner.framework, "tsarch");
  });

  it("accepts framework and dependency assertions", () => {
    const r = TechnicalCheck.parse({
      ...base,
      category: "framework",
      assert: [
        { dependency_present: { name: "next", section: "dependencies" } },
        { dependency_absent: { name: "express", section: "all" } },
        { json_has: { path: "package.json", query: "$.scripts.test" } },
      ],
    });
    assert.equal(r.assert.length, 3);
  });

  it("rejects missing assertions", () => {
    assert.throws(() => {
      TechnicalCheck.parse({ ...base, assert: [] });
    });
  });
});

describe("technicalAssertExpr", () => {
  it("generates dependency_present", () => {
    const code = technicalAssertExpr({ dependency_present: { name: "next", section: "dependencies", path: "package.json" } });
    assert.ok(code.includes("hasDependency"));
    assert.ok(code.includes('"next"'));
  });

  it("generates imports_forbidden", () => {
    const code = technicalAssertExpr({ imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/"] } });
    assert.ok(code.includes("assertForbiddenImports"));
    assert.ok(code.includes("src/domain/**/*.ts"));
  });

  it("generates imports_allowed_only_from", () => {
    const code = technicalAssertExpr({ imports_allowed_only_from: { files: "src/domain/**/*.ts", patterns: ["@/domain"], allow_relative: true } });
    assert.ok(code.includes("assertAllowedImports"));
    assert.ok(code.includes("@/domain"));
  });

  it("generates layer_dependencies", () => {
    const code = technicalAssertExpr({ layer_dependencies: {
      layers: [
        { name: "ui", files: "src/ui/**/*.ts", may_import: ["application"] },
        { name: "application", files: "src/application/**/*.ts", may_import: ["domain"] },
      ],
      allow_external: true,
      allow_unmatched_relative: false,
      allow_same_layer: true,
    } });
    assert.ok(code.includes("assertLayerDependencies"));
  });

  it("generates command assertions", () => {
    const code = technicalAssertExpr({ command_stdout_contains: { command: "echo ok", text: "ok" } });
    assert.ok(code.includes("runCommand"));
    assert.ok(code.includes("toContain"));
  });

  it("generates json_equals", () => {
    const code = technicalAssertExpr({ json_equals: { path: "package.json", query: "$.type", equals: "module" } });
    assert.ok(code.includes('readJson("package.json").type'));
    assert.ok(code.includes('toEqual("module")'));
  });
});

describe("genTechnicalTest", () => {
  it("generates a repo-level Playwright test", () => {
    const code = genTechnicalTest({
      ...base,
      assert: [
        { path_exists: { path: ".github/workflows/ci.yml" } },
        { github_action_uses: { workflow: ".github/workflows/ci.yml", action: "actions/checkout@v4" } },
      ],
    });
    assert.ok(code.includes('import fs from "node:fs"'));
    assert.ok(code.includes('test.describe("Technical: ci"'));
    assert.ok(code.includes("Anti false positive guard"));
    assert.ok(code.includes('__shipflow_false_positive__/missing'));
    assert.ok(code.includes('exists(".github/workflows/ci.yml")'));
    assert.ok(code.includes('actions/checkout@v4'));
  });

  it("includes helper logic for architecture assertions", () => {
    const code = genTechnicalTest({
      ...base,
      category: "architecture",
      runner: { kind: "archtest", framework: "dependency-cruiser" },
      assert: [
        { imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/", "react"] } },
      ],
    });
    assert.ok(code.includes("globToRegExp"));
    assert.ok(code.includes("assertForbiddenImports"));
    assert.ok(code.includes("[dependency-cruiser]"));
  });

  it("includes command and layered architecture helpers", () => {
    const code = genTechnicalTest({
      ...base,
      category: "architecture",
      runner: { kind: "archtest", framework: "madge" },
      assert: [
        { imports_allowed_only_from: { files: "src/domain/**/*.ts", patterns: ["@/domain", "@/shared"], allow_relative: true } },
        { layer_dependencies: {
          layers: [
            { name: "ui", files: "src/ui/**/*.ts", may_import: ["application", "shared"] },
            { name: "application", files: "src/application/**/*.ts", may_import: ["domain", "shared"] },
          ],
          allow_external: true,
          allow_unmatched_relative: false,
          allow_same_layer: true,
        } },
        { command_succeeds: { command: "echo ok" } },
      ],
    });
    assert.ok(code.includes("parseImports"));
    assert.ok(code.includes("assertAllowedImports"));
    assert.ok(code.includes("assertLayerDependencies"));
    assert.ok(code.includes("runCommand"));
    assert.ok(code.includes("[madge]"));
  });
});
