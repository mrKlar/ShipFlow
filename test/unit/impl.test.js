import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildFileContentRepairPrompt,
  buildFileFormatRepairPrompt,
  buildPrompt,
  buildSpecialistPrompt,
  buildStrategyPrompt,
  impl,
  isAllowedImplPath,
  parseFiles,
  resolveImplOptions,
  resolveWritePolicy,
  sanitizeGeneratedFiles,
  validateGeneratedFiles,
} from "../../lib/impl.js";

describe("parseFiles", () => {
  it("parses single file", () => {
    const text = `Some intro text.

--- FILE: src/server.js ---
console.log("hello");
--- END FILE ---

Done.`;
    const files = parseFiles(text);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, "src/server.js");
    assert.equal(files[0].content, 'console.log("hello");\n');
  });

  it("parses multiple files", () => {
    const text = `--- FILE: src/server.js ---
const a = 1;
--- END FILE ---

--- FILE: src/public/index.html ---
<html></html>
--- END FILE ---`;
    const files = parseFiles(text);
    assert.equal(files.length, 2);
    assert.equal(files[0].path, "src/server.js");
    assert.equal(files[1].path, "src/public/index.html");
  });

  it("preserves multiline content", () => {
    const text = `--- FILE: src/app.js ---
line1
line2
line3
--- END FILE ---`;
    const files = parseFiles(text);
    assert.equal(files[0].content, "line1\nline2\nline3\n");
  });

  it("parses file blocks wrapped in markdown fences", () => {
    const text = "```text\n--- FILE: src/app.js ---\nconsole.log(\"ok\");\n--- END FILE ---\n```";
    const files = parseFiles(text);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, "src/app.js");
    assert.equal(files[0].content, 'console.log("ok");\n');
  });

  it("returns empty array for no files", () => {
    assert.deepEqual(parseFiles("no files here"), []);
  });

  it("handles file with empty content", () => {
    const text = `--- FILE: src/.gitkeep ---
--- END FILE ---`;
    const files = parseFiles(text);
    assert.equal(files.length, 1);
    assert.equal(files[0].content, "");
  });
});

describe("buildPrompt", () => {
  const vpFiles = [{ path: "vp/ui/test.yml", content: "id: test\n" }];
  const genFiles = [{ path: ".gen/playwright/test.test.ts", content: "test('x', ...)", label: "UI" }];
  const config = { impl: { srcDir: "src", context: "Node.js app" } };
  const writePolicy = { roots: ["src"], files: ["package.json"] };

  it("includes VP verifications", () => {
    const p = buildPrompt(vpFiles, [], [], config, null, writePolicy);
    assert.ok(p.includes("vp/ui/test.yml"));
    assert.ok(p.includes("id: test"));
  });

  it("includes generated artifacts", () => {
    const p = buildPrompt(vpFiles, genFiles, [], config, null, writePolicy);
    assert.ok(p.includes("Generated Verification Artifacts"));
    assert.ok(p.includes("[UI] .gen/playwright/test.test.ts"));
    assert.ok(p.includes(".gen/playwright/test.test.ts"));
    assert.ok(p.includes("generated executable omitted"));
    assert.ok(!p.includes("test('x', ...)"));
  });

  it("renders non-Playwright generated artifacts with the right labels and fences", () => {
    const p = buildPrompt(vpFiles, [
      { path: ".gen/cucumber/features/checkout.feature", content: "Feature: Checkout", label: "Behavior (Gherkin)" },
      {
        path: ".gen/technical/vp_technical.runner.mjs",
        content: "console.log('technical');",
        label: "Technical",
        output_kind: "technical",
      },
      { path: ".gen/k6/load.js", content: "import http from \"k6/http\";", label: "Performance" },
    ], [], config, null, writePolicy);
    assert.ok(p.includes("[Behavior (Gherkin)] .gen/cucumber/features/checkout.feature"));
    assert.ok(p.includes("generated executable omitted"));
    assert.ok(p.includes("[Technical] .gen/technical/vp_technical.runner.mjs"));
    assert.ok(p.includes("repo-level technical runner omitted"));
    assert.ok(!p.includes("console.log('technical');"));
    assert.ok(p.includes("[Performance] .gen/k6/load.js"));
  });

  it("builds a repo-aware prompt for native CLI providers", () => {
    const p = buildPrompt(
      vpFiles,
      genFiles,
      [{ path: "src/server.js", content: "const x = 1;" }],
      config,
      "Error: boom",
      writePolicy,
      { provider: "claude" },
    );
    assert.ok(p.includes("Read These Verification Files First"));
    assert.ok(p.includes(".shipflow/implement-thread.json"));
    assert.ok(p.includes("vp/ui/test.yml"));
    assert.ok(p.includes(".gen/manifest.json"));
    assert.ok(p.includes("Current Editable Files To Inspect"));
    assert.ok(p.includes("src/server.js"));
    assert.ok(p.includes("Latest Verification Failures"));
    assert.ok(!p.includes("id: test"));
    assert.ok(!p.includes("const x = 1;"));
  });

  it("points repo-aware retries to evidence artifacts instead of embedding huge failure logs", () => {
    const failure = [
      "Summary: 14 passed, 3 failed",
      "UI: FAIL | Technical: FAIL",
      "Error: Expected REST API routes under /api/ for any method",
      "x".repeat(9000),
    ].join("\n");
    const p = buildPrompt(vpFiles, genFiles, [], config, failure, writePolicy, {
      provider: "codex",
      evidenceFiles: ["evidence/run.json", "evidence/ui.json", "evidence/artifacts/ui-blocker.log"],
    });
    assert.ok(p.includes("Failure Evidence To Inspect"));
    assert.ok(p.includes("evidence/run.json"));
    assert.ok(p.includes("Summary: 14 passed, 3 failed"));
    assert.ok(p.includes("Error: Expected REST API routes under /api/ for any method"));
    assert.ok(!p.includes("x".repeat(4000)));
  });

  it("includes project context", () => {
    const p = buildPrompt(vpFiles, [], [], config, null, writePolicy);
    assert.ok(p.includes("Node.js app"));
  });

  it("includes current source code", () => {
    const srcFiles = [{ path: "src/server.js", content: "const x = 1;" }];
    const p = buildPrompt(vpFiles, [], srcFiles, config, null, writePolicy);
    assert.ok(p.includes("src/server.js"));
    assert.ok(p.includes("const x = 1;"));
  });

  it("includes errors on retry", () => {
    const p = buildPrompt(vpFiles, [], [], config, "Error: element not found", writePolicy);
    assert.ok(p.includes("Test Failures"));
    assert.ok(p.includes("Error: element not found"));
  });

  it("forbids fake passes and requires real root-cause fixes", () => {
    const embedded = buildPrompt(vpFiles, [], [], config, null, writePolicy);
    assert.match(embedded, /Fix real root causes/i);
    assert.match(embedded, /Never fake a pass/i);
    assert.match(embedded, /Do not hand-edit lockfiles/i);
    assert.match(embedded, /do not add conflicting package\.json overrides\/resolutions/i);
    const repoAware = buildPrompt(vpFiles, [], [], config, null, writePolicy, { provider: "claude" });
    assert.match(repoAware, /Fix real root causes/i);
    assert.match(repoAware, /Never fake a pass/i);
    assert.match(repoAware, /Do not hand-edit lockfiles/i);
    assert.match(repoAware, /do not add conflicting package\.json overrides\/resolutions/i);
  });

  it("guides frontend work toward an existing or mainstream open-source design-system library", () => {
    const embedded = buildPrompt(vpFiles, [], [], config, null, writePolicy);
    assert.match(embedded, /reuse the design system or open-source design-system component library already present/i);
    assert.match(embedded, /standard, widely used open-source design-system component library/i);
    const repoAware = buildPrompt(vpFiles, [], [], config, null, writePolicy, { provider: "claude" });
    assert.match(repoAware, /reuse the design system or open-source design-system component library already present/i);
    assert.match(repoAware, /Only create a new local shared component library when the user explicitly asks/i);
  });

  it("requires data-engineering normalization before transport boundaries", () => {
    const embedded = buildPrompt(vpFiles, [], [], config, null, writePolicy);
    assert.match(embedded, /transport-safe technical objects/i);
    assert.match(embedded, /Normalize driver-native values such as BigInt row ids/i);
    const repoAware = buildPrompt(vpFiles, [], [], config, null, writePolicy, { provider: "codex" });
    assert.match(repoAware, /transport-safe technical objects/i);
    assert.match(repoAware, /before returning them through JSON, REST, GraphQL, UI state, or events/i);
  });

  it("truncates long errors to 8000 chars", () => {
    const longError = "x".repeat(10000);
    const p = buildPrompt(vpFiles, [], [], config, longError, writePolicy);
    assert.ok(p.includes("x".repeat(8000)));
    assert.ok(!p.includes("x".repeat(9000)));
  });

  it("includes output format instructions", () => {
    const p = buildPrompt(vpFiles, [], [], config, null, writePolicy);
    assert.ok(p.includes("--- FILE: path/to/file ---"));
    assert.ok(p.includes("--- END FILE ---"));
  });

  it("uses default srcDir if not configured", () => {
    const p = buildPrompt(vpFiles, [], [], {}, null, { roots: ["src"], files: [] });
    assert.ok(p.includes("src/**"));
  });

  it("lists repo-level editable targets when they are allowed", () => {
    const p = buildPrompt(vpFiles, [], [], config, null, { roots: ["src", ".github/workflows"], files: ["package.json"] });
    assert.ok(p.includes(".github/workflows/**"));
    assert.ok(p.includes("package.json"));
  });

  it("does not allow lockfiles by default in the write policy", () => {
    const p = buildPrompt(vpFiles, [], [], config, null, { roots: ["src"], files: ["package.json"] });
    assert.ok(!p.includes("package-lock.json"));
    assert.ok(!p.includes("pnpm-lock.yaml"));
    assert.ok(!p.includes("yarn.lock"));
  });

  it("treats .shipflow as a blocked internal path", () => {
    const p = buildPrompt(vpFiles, [], [], config, null, { roots: ["src"], files: ["package.json"] });
    assert.ok(p.includes(".shipflow/"));
  });
});

describe("buildFileFormatRepairPrompt", () => {
  it("preserves the original prompt and adds strict correction instructions", () => {
    const prompt = "Original implementation prompt";
    const repair = buildFileFormatRepairPrompt(prompt, "Here is the plan.");
    assert.ok(repair.includes(prompt));
    assert.ok(repair.includes("did not include any valid ShipFlow file blocks"));
    assert.ok(repair.includes("--- FILE: path/to/file ---"));
    assert.ok(repair.includes("Here is the plan."));
  });
});

describe("buildFileContentRepairPrompt", () => {
  it("preserves the original prompt and lists invalid content issues", () => {
    const prompt = "Original implementation prompt";
    const repair = buildFileContentRepairPrompt(prompt, "--- FILE: package.json ---\n{bad json}\n--- END FILE ---", [
      "package.json: Expected property name or '}' in JSON",
    ]);
    assert.ok(repair.includes(prompt));
    assert.ok(repair.includes("included ShipFlow file blocks, but one or more file contents were invalid"));
    assert.ok(repair.includes("package.json: Expected property name"));
    assert.ok(repair.includes("*.json file you return must be valid JSON"));
  });
});

describe("team prompts", () => {
  it("builds a strategy prompt with stagnation guidance and compact memo", () => {
    const prompt = buildStrategyPrompt({
      teamConfig: {
        roles: ["architecture", "ui", "api"],
      },
      provider: "codex",
      memo: {
        stagnation_streak: 2,
        recent_attempts: [{ iteration: 1, verify: { failed: 2 } }],
      },
      orchestration: {
        iteration: 3,
        maxIterations: 50,
        remainingDurationMs: 120000,
        stagnationCount: 2,
        mustChangeStrategy: true,
      },
      prompt: "Base implementation context",
    });
    assert.match(prompt, /strategy lead/i);
    assert.match(prompt, /shipflow_strategy_lead/);
    assert.match(prompt, /must choose a materially different approach/i);
    assert.match(prompt, /come back when they have exhausted the straightforward ideas/i);
    assert.match(prompt, /Compact implementation memo/i);
    assert.match(prompt, /architecture/i);
    assert.match(prompt, /Base implementation context/);
  });

  it("builds provider-native strategy prompts for Claude, Gemini, and Kiro", () => {
    const base = {
      teamConfig: { roles: ["architecture", "ui", "api"] },
      memo: { recent_attempts: [] },
      orchestration: { iteration: 1, maxIterations: 50, stagnationCount: 0, mustChangeStrategy: false },
      prompt: "Base implementation context",
    };
    assert.match(buildStrategyPrompt({ ...base, provider: "claude" }), /Task tool/i);
    assert.match(buildStrategyPrompt({ ...base, provider: "claude" }), /~\/\.claude\/agents/);
    assert.match(buildStrategyPrompt({ ...base, provider: "gemini" }), /\/shipflow:strategy-lead/);
    assert.match(buildStrategyPrompt({ ...base, provider: "kiro" }), /subagent tool/i);
    assert.match(buildStrategyPrompt({ ...base, provider: "kiro" }), /~\/\.kiro\/agents/);
  });

  it("builds a specialist prompt that keeps the role focused and team-aware", () => {
    const prompt = buildSpecialistPrompt("Base implementation prompt", {
      role: "api",
      goal: "Fix the GraphQL mutation flow",
      why_now: "API checks are failing",
      focus_types: ["api", "behavior_gherkin"],
      instructions: ["Repair transport normalization", "Keep schema and resolver aligned"],
    }, {
      mustChangeStrategy: true,
      memo: { recent_attempts: [{ iteration: 2 }] },
    }, "codex");
    assert.match(prompt, /API Specialist/);
    assert.match(prompt, /shipflow_api_specialist/);
    assert.match(prompt, /You are not alone in the codebase/i);
    assert.match(prompt, /Fix the GraphQL mutation flow/);
    assert.match(prompt, /must try a materially different fix path/i);
    assert.match(prompt, /return early with a blocker report/i);
    assert.match(prompt, /\"status\": \"blocked\"/i);
    assert.match(prompt, /Base implementation prompt/);
  });

  it("builds provider-native specialist prompts for Gemini, Claude, and Kiro", () => {
    const assignment = {
      role: "ui",
      goal: "Fix the visible todo filter",
      focus_types: ["ui"],
    };
    assert.match(buildSpecialistPrompt("Base prompt", assignment, {}, "gemini"), /\/shipflow:ui-specialist/);
    assert.match(buildSpecialistPrompt("Base prompt", assignment, {}, "claude"), /Task tool/i);
    assert.match(buildSpecialistPrompt("Base prompt", assignment, {}, "claude"), /shipflow-ui-specialist/);
    assert.match(buildSpecialistPrompt("Base prompt", assignment, {}, "codex"), /shipflow_ui_specialist/);
    assert.match(buildSpecialistPrompt("Base prompt", assignment, {}, "kiro"), /subagent tool/i);
    assert.match(buildSpecialistPrompt("Base prompt", assignment, {}, "kiro"), /shipflow-ui-specialist/);
  });
});

describe("validateGeneratedFiles", () => {
  it("salvages balanced json objects with trailing provider noise", () => {
    const files = sanitizeGeneratedFiles([
      {
        path: "package.json",
        content: "{\n  \"name\": \"ok\"\n}\nThanks!\n",
      },
    ]);
    assert.equal(files[0].content, "{\n  \"name\": \"ok\"\n}\n");
    assert.deepEqual(validateGeneratedFiles(files), []);
  });

  it("flags malformed json files before ShipFlow writes them", () => {
    assert.deepEqual(
      validateGeneratedFiles([
        { path: "package.json", content: "{\n  \"name\": \"ok\"\n}\n}\n" },
        { path: "src/server.js", content: "console.log('ok');\n" },
      ]),
      ["package.json: Unexpected non-whitespace character after JSON at position 19 (line 4 column 1)"],
    );
  });

  it("accepts valid json object files", () => {
    assert.deepEqual(
      validateGeneratedFiles([{ path: "package.json", content: "{\n  \"name\": \"ok\"\n}\n" }]),
      [],
    );
  });
});

describe("resolveImplOptions", () => {
  it("prefers env and explicit config provider/model", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        impl: {
          provider: "command",
          model: "custom-model",
          srcDir: "app",
          command: { bin: "cat", args: [] },
        },
      }));
      const previousProvider = process.env.SHIPFLOW_IMPL_PROVIDER;
      const previousModel = process.env.SHIPFLOW_IMPL_MODEL;
      process.env.SHIPFLOW_IMPL_PROVIDER = "anthropic";
      process.env.SHIPFLOW_IMPL_MODEL = "override-model";
      try {
        const options = resolveImplOptions(tmpDir);
        assert.equal(options.provider, "anthropic");
        assert.equal(options.model, "override-model");
        assert.equal(options.srcDir, "app");
      } finally {
        if (previousProvider === undefined) delete process.env.SHIPFLOW_IMPL_PROVIDER;
        else process.env.SHIPFLOW_IMPL_PROVIDER = previousProvider;
        if (previousModel === undefined) delete process.env.SHIPFLOW_IMPL_MODEL;
        else process.env.SHIPFLOW_IMPL_MODEL = previousModel;
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses anthropic defaults when config is absent", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-"));
    try {
      const options = resolveImplOptions(tmpDir, {}, {
        commandExists: cmd => cmd === "codex",
      });
      assert.equal(options.provider, "codex");
      assert.equal(options.model, "gpt-5-codex");
      assert.equal(options.srcDir, "src");
      assert.equal(options.timeoutMs, 3600000);
      assert.ok(options.writePolicy.roots.includes("src"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("respects impl timeoutMs from config", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), JSON.stringify({
        impl: {
          timeoutMs: 12345,
        },
      }));
      const options = resolveImplOptions(tmpDir, {}, {
        commandExists: cmd => cmd === "claude",
      });
      assert.equal(options.timeoutMs, 12345);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("prefers the active CLI environment for auto provider resolution", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-"));
    try {
      const options = resolveImplOptions(tmpDir, {}, {
        commandExists: cmd => cmd === "codex" || cmd === "claude",
        env: { CODEX_THREAD_ID: "thread-123" },
      });
      assert.equal(options.provider, "codex");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("derives repo-level write targets from technical checks", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "technical"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "technical", "ci.yml"), `id: technical-ci
title: CI workflow exists
severity: blocker
category: ci
runner:
  kind: custom
  framework: custom
app:
  kind: technical
  root: .
assert:
  - path_exists: { path: ".github/workflows/ci.yml" }
  - dependency_present: { name: "@playwright/test", section: devDependencies }
`);
      const policy = resolveWritePolicy(tmpDir, { impl: { srcDir: "src" } });
      assert.ok(policy.roots.includes(".github/workflows"));
      assert.ok(policy.files.includes("package.json"));
      assert.equal(isAllowedImplPath(".github/workflows/ci.yml", policy), true);
      assert.equal(isAllowedImplPath("README.md", policy), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("never derives blocked write targets from config or technical checks", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "technical"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "technical", "blocked.yml"), `id: technical-blocked
title: Blocked paths stay blocked
severity: blocker
category: other
runner:
  kind: custom
  framework: custom
app:
  kind: technical
  root: .
assert:
  - path_exists: { path: "vp/ui/example.yml" }
  - path_exists: { path: ".gen/manifest.json" }
  - path_exists: { path: "evidence/run.json" }
`);
      const policy = resolveWritePolicy(tmpDir, {
        impl: {
          srcDir: "src",
          writeRoots: ["vp", ".gen", "evidence", ".shipflow", "docs"],
        },
      });
      assert.equal(policy.roots.includes("vp"), false);
      assert.equal(policy.roots.includes(".gen"), false);
      assert.equal(policy.roots.includes("evidence"), false);
      assert.equal(policy.roots.includes(".shipflow"), false);
      assert.equal(policy.roots.includes("docs"), true);
      assert.equal(policy.files.includes("vp/ui/example.yml"), false);
      assert.equal(policy.files.includes(".gen/manifest.json"), false);
      assert.equal(policy.files.includes("evidence/run.json"), false);
      assert.equal(isAllowedImplPath("vp/ui/example.yml", policy), false);
      assert.equal(isAllowedImplPath("docs/README.md", policy), true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("impl", () => {
  it("retries once when the provider returns a plan instead of file blocks", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-run-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\ntitle: Home\nseverity: blocker\napp:\n  kind: web\n  base_url: http://localhost:3000\nflow:\n  - open: /\nassert:\n  - visible: { text: Home }\n");

      const prompts = [];
      let calls = 0;
      const result = await impl({
        cwd: tmpDir,
        provider: "command",
        deps: {
          generateWithProvider: async ({ prompt, responseFormat }) => {
            prompts.push(prompt);
            calls += 1;
            if (responseFormat === "json") {
              return JSON.stringify({
                summary: "Route UI work to the UI specialist.",
                approach: "UI-first",
                changed_approach: false,
                root_causes: ["Missing page"],
                assignments: [{ role: "ui", goal: "Create the home screen", why_now: "UI is missing", focus_types: ["ui"] }],
              });
            }
            if (calls === 2) return "Plan: create src/server.js and package.json";
            return "--- FILE: src/server.js ---\nconsole.log('ok');\n--- END FILE ---";
          },
        },
      });

      assert.equal(calls, 3);
      assert.equal(result.written[0], "src/server.js");
      assert.equal(fs.readFileSync(path.join(tmpDir, "src", "server.js"), "utf-8"), "console.log('ok');\n");
      assert.ok(prompts[2].includes("Specialist Return Correction"));
      assert.ok(prompts[2].includes("Previous invalid reply"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws after a correction retry still returns no file blocks", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-run-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      await assert.rejects(
        () => impl({
          cwd: tmpDir,
          provider: "command",
          deps: {
            generateWithProvider: async () => "Still just a plan.",
          },
        }),
        /returned no files/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("retries when the provider returns malformed json content", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-run-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      const prompts = [];
      let calls = 0;
      const result = await impl({
        cwd: tmpDir,
        provider: "command",
        deps: {
          generateWithProvider: async ({ prompt, responseFormat }) => {
            prompts.push(prompt);
            calls += 1;
            if (responseFormat === "json") {
              return JSON.stringify({
                summary: "API and package metadata need to be written.",
                approach: "Bootstrap package metadata first",
                changed_approach: false,
                root_causes: ["Missing package.json"],
                assignments: [{ role: "technical", goal: "Write package.json and server entrypoint", why_now: "Runtime files are missing", focus_types: ["technical"] }],
              });
            }
            if (calls === 2) {
              return [
                "--- FILE: package.json ---",
                "{",
                "  \"name\": \"broken\",",
                "--- END FILE ---",
              ].join("\n");
            }
            return [
              "--- FILE: package.json ---",
              "{",
              "  \"name\": \"fixed\"",
              "}",
              "--- END FILE ---",
              "",
              "--- FILE: src/server.js ---",
              "console.log('ok');",
              "--- END FILE ---",
            ].join("\n");
          },
        },
      });

      assert.equal(calls, 3);
      assert.deepEqual(result.written, ["package.json", "src/server.js"]);
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8")).name, "fixed");
      assert.ok(prompts[2].includes("Content Correction"));
      assert.ok(prompts[2].includes("package.json:"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs a strategy lead and multiple specialists in one iteration", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-run-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\ntitle: Home\nseverity: blocker\napp:\n  kind: web\n  base_url: http://localhost:3000\nflow:\n  - open: /\nassert:\n  - visible: { text: Home }\n");

      const requestedRoles = [];
      const result = await impl({
        cwd: tmpDir,
        provider: "command",
        deps: {
          generateWithProvider: async ({ prompt, responseFormat }) => {
            if (responseFormat === "json") {
              return JSON.stringify({
                summary: "Split the work between API and UI.",
                approach: "Parallel specialties",
                changed_approach: false,
                root_causes: ["Missing API", "Missing UI"],
                assignments: [
                  { role: "api", goal: "Create the HTTP handler", why_now: "API is missing", focus_types: ["api"] },
                  { role: "ui", goal: "Render the home page", why_now: "UI is missing", focus_types: ["ui"] },
                ],
              });
            }
            if (/API Specialist/.test(prompt)) {
              requestedRoles.push("api");
              return "--- FILE: src/server.js ---\nconsole.log('api');\n--- END FILE ---";
            }
            requestedRoles.push("ui");
            return "--- FILE: src/app.js ---\nconsole.log('ui');\n--- END FILE ---";
          },
        },
      });

      assert.deepEqual(requestedRoles, ["api", "ui"]);
      assert.deepEqual(result.written, ["src/server.js", "src/app.js"]);
      assert.equal(result.strategyPlan.approach, "Parallel specialties");
      assert.deepEqual(result.specialists.map(item => item.role), ["api", "ui"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("accepts an early blocker report from a specialist and keeps writable results from others", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-run-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\ntitle: Home\nseverity: blocker\napp:\n  kind: web\n  base_url: http://localhost:3000\nflow:\n  - open: /\nassert:\n  - visible: { text: Home }\n");

      const result = await impl({
        cwd: tmpDir,
        provider: "command",
        deps: {
          generateWithProvider: async ({ prompt, responseFormat }) => {
            if (responseFormat === "json") {
              return JSON.stringify({
                summary: "Split between UI and API.",
                approach: "UI plus API handoff",
                changed_approach: false,
                root_causes: ["UI missing", "API root cause unclear"],
                assignments: [
                  { role: "api", goal: "Investigate API blocker", why_now: "Behavior is red", focus_types: ["api"] },
                  { role: "ui", goal: "Render the home page", why_now: "UI is missing", focus_types: ["ui"] },
                ],
              });
            }
            if (/API Specialist/.test(prompt)) {
              return JSON.stringify({
                status: "blocked",
                summary: "The API slice reached the point where schema work depends on the missing persistence contract.",
                exhausted_simple_paths: true,
                tried: ["checked the generated API contract", "looked for an existing persistence model"],
                blockers: ["No persistence model exists yet for the mutation payload"],
                handoff_role: "database",
                suggested_next_step: "Ask the database specialist to define the write model first.",
              });
            }
            return "--- FILE: src/app.js ---\nconsole.log('ui');\n--- END FILE ---";
          },
        },
      });

      assert.deepEqual(result.written, ["src/app.js"]);
      assert.equal(result.specialists.length, 2);
      assert.equal(result.specialists[0].status, "blocked");
      assert.equal(result.specialists[0].blocker_report.handoff_role, "database");
      assert.equal(result.specialists[1].status, "wrote");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns blocker reports instead of throwing when no specialist finds a simple safe fix", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-run-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      const result = await impl({
        cwd: tmpDir,
        provider: "command",
        deps: {
          generateWithProvider: async ({ responseFormat }) => {
            if (responseFormat === "json") {
              return JSON.stringify({
                summary: "Only architecture should look first.",
                approach: "Return blocked",
                changed_approach: false,
                root_causes: ["No simple path"],
                assignments: [{ role: "architecture", goal: "Diagnose the slice", why_now: "Need a handoff", focus_types: ["technical"] }],
              });
            }
            return JSON.stringify({
              status: "blocked",
              summary: "The narrow slice exhausted the obvious fixes and needs an orchestrator strategy change.",
              exhausted_simple_paths: true,
              tried: ["checked the existing runtime entrypoints"],
              blockers: ["The fix would require a broader rewrite than this slice owns"],
              suggested_next_step: "Pick a different slice ordering and retry.",
            });
          },
        },
      });

      assert.deepEqual(result.written, []);
      assert.equal(result.specialists.length, 1);
      assert.equal(result.specialists[0].status, "blocked");
      assert.match(result.specialists[0].blocker_report.summary, /exhausted the obvious fixes/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
