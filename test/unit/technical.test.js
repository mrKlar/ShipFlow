import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TechnicalCheck } from "../../lib/schema/technical-check.zod.js";
import { technicalAssertExpr, genTechnicalArtifacts } from "../../lib/gen-technical.js";

const base = {
  id: "technical-ci",
  title: "Repository uses GitHub Actions for CI",
  severity: "blocker",
  category: "ci",
  app: { kind: "technical", root: "." },
};

async function runGeneratedRunner(runnerFile, cwd) {
  const stdout = [];
  const stderr = [];
  let status = 0;
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;

  try {
    process.chdir(cwd);
    console.log = (...args) => stdout.push(args.join(" "));
    console.error = (...args) => stderr.push(args.join(" "));
    process.exit = code => {
      status = Number(code ?? 0);
      throw new Error(`__SHIPFLOW_EXIT__:${status}`);
    };

    try {
      const specifier = `${pathToFileURL(runnerFile).href}?run=${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await import(specifier);
      await new Promise(resolve => setImmediate(resolve));
    } catch (error) {
      if (!String(error?.message || error).startsWith("__SHIPFLOW_EXIT__:")) throw error;
    }
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return {
    status,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
  };
}

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

  it("accepts architecture checks with dependency-cruiser", () => {
    const r = TechnicalCheck.parse({
      ...base,
      category: "architecture",
      runner: { kind: "archtest", framework: "dependency-cruiser" },
      assert: [
        { imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/**", "react"] } },
        { layer_dependencies: {
          layers: [
            { name: "ui", files: "src/ui/**/*.ts", may_import: ["application", "shared"] },
            { name: "application", files: "src/application/**/*.ts", may_import: ["domain", "shared"] },
            { name: "domain", files: "src/domain/**/*.ts", may_import: ["shared"] },
          ],
        } },
      ],
    });
    assert.equal(r.runner.kind, "archtest");
    assert.equal(r.runner.framework, "dependency-cruiser");
  });

  it("accepts tsarch and circular dependency assertions", () => {
    const r = TechnicalCheck.parse({
      ...base,
      category: "architecture",
      runner: { kind: "archtest", framework: "tsarch" },
      assert: [
        { no_circular_dependencies: { files: "src/**/*.ts", tsconfig: "tsconfig.json" } },
      ],
    });
    assert.equal(r.runner.framework, "tsarch");
    assert.equal(r.assert.length, 1);
  });

  it("accepts eslint-plugin-boundaries as an architecture framework", () => {
    const r = TechnicalCheck.parse({
      ...base,
      category: "architecture",
      runner: { kind: "archtest", framework: "eslint-plugin-boundaries" },
      assert: [
        { layer_dependencies: {
          layers: [
            { name: "ui", files: "src/ui/**/*.ts", may_import: ["application"] },
            { name: "application", files: "src/application/**/*.ts", may_import: ["domain"] },
          ],
        } },
      ],
    });
    assert.equal(r.runner.framework, "eslint-plugin-boundaries");
  });

  it("accepts framework and dependency assertions", () => {
    const r = TechnicalCheck.parse({
      ...base,
      category: "framework",
      assert: [
        { dependency_present: { name: "next", section: "dependencies" } },
        { dependency_version_matches: { name: "next", section: "dependencies", matches: "^14\\." } },
        { dependency_absent: { name: "express", section: "all" } },
        { json_has: { path: "package.json", query: "$.scripts.test" } },
        { json_matches: { path: "package.json", query: "$.packageManager", matches: "^pnpm@" } },
        { script_present: { name: "build" } },
        { script_contains: { name: "test:e2e", text: "playwright" } },
      ],
    });
    assert.equal(r.assert.length, 7);
  });

  it("accepts protocol assertions for GraphQL and REST", () => {
    const r = TechnicalCheck.parse({
      ...base,
      category: "framework",
      assert: [
        { graphql_surface_present: { files: "**/*", endpoint: "/graphql" } },
        { rest_api_absent: { files: "**/*", path_prefix: "/api/", allow_paths: ["/graphql", "/api/graphql"] } },
      ],
    });
    assert.equal(r.assert.length, 2);
  });

  it("leaves REST methods unspecified when not explicitly provided", () => {
    const r = TechnicalCheck.parse({
      ...base,
      category: "framework",
      assert: [
        { rest_api_present: { files: "**/*", path_prefix: "/api/" } },
      ],
    });
    assert.equal(r.assert[0].rest_api_present.methods, undefined);
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

  it("generates stack and script assertions", () => {
    const versionCode = technicalAssertExpr({ dependency_version_matches: { name: "next", section: "dependencies", path: "package.json", matches: "^14\\." } });
    const jsonCode = technicalAssertExpr({ json_matches: { path: "package.json", query: "$.packageManager", matches: "^pnpm@" } });
    const scriptCode = technicalAssertExpr({ script_contains: { name: "test:e2e", path: "package.json", text: "playwright" } });
    const globCode = technicalAssertExpr({ glob_count_gte: { glob: ".github/workflows/*.yml", gte: 1 } });
    assert.ok(versionCode.includes("dependencyVersion"));
    assert.ok(jsonCode.includes("assertMatches"));
    assert.ok(scriptCode.includes("packageScript"));
    assert.ok(globCode.includes(">= 1"));
  });

  it("generates protocol assertions", () => {
    const graphqlCode = technicalAssertExpr({ graphql_surface_present: { files: "**/*", endpoint: "/graphql" } });
    const restPresentCode = technicalAssertExpr({ rest_api_present: { files: "**/*", path_prefix: "/api/" } });
    const restAbsentCode = technicalAssertExpr({ rest_api_absent: { files: "**/*", path_prefix: "/api/", allow_paths: ["/api/graphql"] } });
    const graphqlAbsentCode = technicalAssertExpr({ graphql_surface_absent: { files: "**/*", endpoint: "/graphql" } });
    assert.ok(graphqlCode.includes("assertGraphqlSurfacePresent"));
    assert.ok(restPresentCode.includes("assertRestApiPresent"));
    assert.ok(restAbsentCode.includes("assertRestApiAbsent"));
    assert.ok(graphqlAbsentCode.includes("assertGraphqlSurfaceAbsent"));
  });

  it("generates imports_forbidden", () => {
    const code = technicalAssertExpr({ imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/"] } });
    assert.ok(code.includes("assertForbiddenImports"));
    assert.ok(code.includes("src/domain/**/*.ts"));
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

  it("generates no_circular_dependencies", () => {
    const code = technicalAssertExpr({ no_circular_dependencies: { files: "src/**/*.ts" } });
    assert.ok(code.includes("assertNoCircularDependencies"));
    assert.ok(code.includes("src/**/*.ts"));
  });

  it("generates command assertions", () => {
    const code = technicalAssertExpr({ command_stdout_contains: { command: "echo ok", text: "ok" } });
    assert.ok(code.includes("runCommand"));
    assert.ok(code.includes("stdout.includes"));
  });
});

describe("genTechnicalArtifacts", () => {
  it("generates a dedicated technical runner for custom checks", () => {
    const artifacts = genTechnicalArtifacts({
      ...base,
      __file: "vp/technical/ci-stack.yml",
      runner: { kind: "custom", framework: "custom" },
      assert: [
        { path_exists: { path: ".github/workflows/ci.yml" } },
        { github_action_uses: { workflow: ".github/workflows/ci.yml", action: "actions/checkout@v4" } },
        { script_present: { name: "build" } },
      ],
    });
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].name, "vp_technical_ci-stack.runner.mjs");
    assert.ok(artifacts[0].content.includes("ShipFlow technical backend"));
    assert.ok(artifacts[0].content.includes("runFrameworkBackend"));
    assert.ok(artifacts[0].content.includes("runGenericAssertions"));
    assert.ok(artifacts[0].content.includes("actions/checkout@v4"));
    assert.ok(artifacts[0].content.includes("packageScript"));
  });

  it("generates dependency-cruiser config companions", () => {
    const artifacts = genTechnicalArtifacts({
      ...base,
      __file: "vp/technical/architecture.yml",
      category: "architecture",
      runner: { kind: "archtest", framework: "dependency-cruiser" },
      assert: [
        { imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/**", "react"] } },
        { layer_dependencies: {
          layers: [
            { name: "ui", files: "src/ui/**/*.ts", may_import: ["application", "shared"] },
            { name: "application", files: "src/application/**/*.ts", may_import: ["domain", "shared"] },
            { name: "domain", files: "src/domain/**/*.ts", may_import: ["shared"] },
          ],
        } },
      ],
    });
    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[1].relative_dir, "config");
    assert.ok(artifacts[0].content.includes("runDependencyCruiser"));
    assert.ok(artifacts[0].content.includes("dependency-cruiser"));
    assert.ok(artifacts[1].content.includes("shipflow-layer-dependencies"));
  });

  it("generates tsarch-backed architecture runners", () => {
    const artifacts = genTechnicalArtifacts({
      ...base,
      __file: "vp/technical/tsarch.yml",
      category: "architecture",
      runner: { kind: "archtest", framework: "tsarch" },
      assert: [
        { imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/**"] } },
        { no_circular_dependencies: { files: "src/**/*.ts" } },
      ],
    });
    assert.equal(artifacts.length, 1);
    assert.ok(artifacts[0].content.includes('await import("tsarch")'));
    assert.ok(artifacts[0].content.includes(".matchingPattern(rule.files).shouldNot().dependOnFiles().matchingPattern(pattern).check()"));
    assert.ok(artifacts[0].content.includes(".should().beFreeOfCycles().check()"));
  });

  it("generates eslint-plugin-boundaries configs when requested", () => {
    const artifacts = genTechnicalArtifacts({
      ...base,
      __file: "vp/technical/boundaries.yml",
      category: "architecture",
      runner: { kind: "archtest", framework: "eslint-plugin-boundaries" },
      assert: [
        { layer_dependencies: {
          layers: [
            { name: "ui", files: "src/ui/**/*.ts", may_import: ["application"] },
            { name: "application", files: "src/application/**/*.ts", may_import: ["domain"] },
            { name: "domain", files: "src/domain/**/*.ts", may_import: [] },
          ],
        } },
      ],
    });
    assert.equal(artifacts.length, 2);
    assert.ok(artifacts[0].content.includes("runEslintBoundaries"));
    assert.ok(artifacts[1].content.includes('import boundaries from "eslint-plugin-boundaries"'));
    assert.ok(artifacts[1].content.includes('"boundaries/element-types"'));
  });

  it("executes GraphQL and REST protocol assertions in the generated runner", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-technical-runner-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "app", "api", "graphql"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.ts"), [
        'import { createYoga } from "graphql-yoga";',
        "export const yoga = createYoga({ schema: {} });",
        "",
      ].join("\n"));
      fs.writeFileSync(path.join(tmpDir, "app", "api", "graphql", "route.ts"), [
        "export async function POST() {",
        "  return Response.json({ data: { ok: true } });",
        "}",
        "",
      ].join("\n"));

      const [runner] = genTechnicalArtifacts({
        ...base,
        __file: "vp/technical/protocol.yml",
        category: "framework",
        runner: { kind: "custom", framework: "custom" },
        assert: [
          { graphql_surface_present: { files: "**/*", endpoint: "/graphql" } },
          { rest_api_absent: { files: "**/*", path_prefix: "/api/", allow_paths: ["/graphql", "/api/graphql"] } },
        ],
      });

      const runnerFile = path.join(tmpDir, runner.name);
      fs.writeFileSync(runnerFile, runner.content, { mode: 0o755 });
      const result = await runGeneratedRunner(runnerFile, tmpDir);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /PASS technical-ci/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("treats rest_api_present without methods as any REST method", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-technical-rest-any-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "app", "api", "todos"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "app", "api", "todos", "route.ts"), [
        "export async function GET() {",
        "  return Response.json([]);",
        "}",
        "",
      ].join("\n"));

      const [runner] = genTechnicalArtifacts({
        ...base,
        __file: "vp/technical/rest.yml",
        category: "framework",
        runner: { kind: "custom", framework: "custom" },
        assert: [
          { rest_api_present: { files: "app/**/*", path_prefix: "/api/" } },
        ],
      });

      const runnerFile = path.join(tmpDir, runner.name);
      fs.writeFileSync(runnerFile, runner.content, { mode: 0o755 });
      const result = await runGeneratedRunner(runnerFile, tmpDir);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects REST routes declared in a native node:http server", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-technical-rest-node-http-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), [
        "const pathname = url.pathname;",
        "if (pathname === '/api/todos' && req.method === 'GET') {",
        "  return sendJson(res, 200, []);",
        "}",
        "",
      ].join("\n"));

      const [runner] = genTechnicalArtifacts({
        ...base,
        __file: "vp/technical/rest-node-http.yml",
        category: "framework",
        runner: { kind: "custom", framework: "custom" },
        assert: [
          { rest_api_present: { files: "src/**/*", path_prefix: "/api/" } },
        ],
      });

      const runnerFile = path.join(tmpDir, runner.name);
      fs.writeFileSync(runnerFile, runner.content, { mode: 0o755 });
      const result = await runGeneratedRunner(runnerFile, tmpDir);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects REST routes declared with nested pathname and method checks", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-technical-rest-node-nested-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), [
        "const pathname = url.pathname;",
        "if (pathname === '/api/todos') {",
        "  if (req.method === 'GET') {",
        "    return sendJson(res, 200, []);",
        "  }",
        "  if (req.method === 'POST') {",
        "    return sendJson(res, 201, {});",
        "  }",
        "}",
        "const match = pathname.match(/^\\/api\\/todos\\/(\\d+)$/);",
        "if (match) {",
        "  if (req.method === 'PATCH') {",
        "    return sendJson(res, 200, {});",
        "  }",
        "}",
        "",
      ].join("\n"));

      const [runner] = genTechnicalArtifacts({
        ...base,
        __file: "vp/technical/rest-node-http-nested.yml",
        category: "framework",
        runner: { kind: "custom", framework: "custom" },
        assert: [
          { rest_api_present: { files: "src/**/*", path_prefix: "/api/" } },
        ],
      });

      const runnerFile = path.join(tmpDir, runner.name);
      fs.writeFileSync(runnerFile, runner.content, { mode: 0o755 });
      const result = await runGeneratedRunner(runnerFile, tmpDir);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects REST routes declared through local path and method aliases", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-technical-rest-node-alias-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), [
        "const path = url.pathname;",
        "const method = req.method;",
        "if (path === '/api/todos' && method === 'GET') {",
        "  return sendJson(res, 200, []);",
        "}",
        "",
      ].join("\n"));

      const [runner] = genTechnicalArtifacts({
        ...base,
        __file: "vp/technical/rest-node-alias.yml",
        category: "framework",
        runner: { kind: "custom", framework: "custom" },
        assert: [
          { rest_api_present: { files: "src/**/*", path_prefix: "/api/" } },
        ],
      });

      const runnerFile = path.join(tmpDir, runner.name);
      fs.writeFileSync(runnerFile, runner.content, { mode: 0o755 });
      const result = await runGeneratedRunner(runnerFile, tmpDir);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
