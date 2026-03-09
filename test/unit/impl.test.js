import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildFileFormatRepairPrompt,
  buildPrompt,
  impl,
  isAllowedImplPath,
  parseFiles,
  resolveImplOptions,
  resolveWritePolicy,
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
    assert.ok(p.includes("vp/ui/test.yml"));
    assert.ok(p.includes(".gen/manifest.json"));
    assert.ok(p.includes("Current Editable Files To Inspect"));
    assert.ok(p.includes("src/server.js"));
    assert.ok(p.includes("Latest Verification Failures"));
    assert.ok(!p.includes("id: test"));
    assert.ok(!p.includes("const x = 1;"));
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
      assert.equal(options.timeoutMs, 600000);
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
          writeRoots: ["vp", ".gen", "evidence", "docs"],
        },
      });
      assert.equal(policy.roots.includes("vp"), false);
      assert.equal(policy.roots.includes(".gen"), false);
      assert.equal(policy.roots.includes("evidence"), false);
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
      const written = await impl({
        cwd: tmpDir,
        provider: "command",
        deps: {
          generateWithProvider: async ({ prompt }) => {
            prompts.push(prompt);
            calls += 1;
            if (calls === 1) return "Plan: create src/server.js and package.json";
            return "--- FILE: src/server.js ---\nconsole.log('ok');\n--- END FILE ---";
          },
        },
      });

      assert.equal(calls, 2);
      assert.equal(written[0], "src/server.js");
      assert.equal(fs.readFileSync(path.join(tmpDir, "src", "server.js"), "utf-8"), "console.log('ok');\n");
      assert.ok(prompts[1].includes("Format Correction"));
      assert.ok(prompts[1].includes("Previous invalid reply"));
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
        /AI returned no files/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
