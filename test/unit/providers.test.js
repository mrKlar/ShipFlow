import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildKiroCliArgs,
  buildClaudeCliArgs,
  buildGeminiCliArgs,
  claudeAllowedToolsForResponseFormat,
  claudeEffortForResponseFormat,
  claudePermissionModeForResponseFormat,
  claudeToolsForResponseFormat,
  cliProviderChildEnv,
  codexEffortForResponseFormat,
  codexSandboxModeForResponseFormat,
  defaultModelForProvider,
  DEFAULT_PROVIDER_MAX_BUFFER_BYTES,
  extractClaudeCliText,
  normalizeProviderText,
  providerReady,
  resolveAutoProvider,
} from "../../lib/providers/index.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-providers-"));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("resolveAutoProvider", () => {
  it("prefers the active Codex environment when available", () => {
    withTmpDir(tmpDir => {
      const provider = resolveAutoProvider(tmpDir, {
        commandExists: cmd => cmd === "codex" || cmd === "claude",
        env: { CODEX_THREAD_ID: "thread-1" },
      });
      assert.equal(provider, "codex");
    });
  });

  it("uses configured project surfaces for Kiro when its CLI exists", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "KIRO.md"), "# ShipFlow\n");
      const provider = resolveAutoProvider(tmpDir, {
        commandExists: cmd => cmd === "kiro-cli",
        env: {},
      });
      assert.equal(provider, "kiro");
    });
  });

  it("falls back to anthropic when no local CLI is available", () => {
    withTmpDir(tmpDir => {
      const provider = resolveAutoProvider(tmpDir, {
        commandExists: () => false,
        env: { ANTHROPIC_API_KEY: "test-key" },
      });
      assert.equal(provider, "anthropic");
    });
  });
});

describe("providerReady", () => {
  it("supports local and command readiness checks", () => {
    assert.equal(providerReady("local", {}, {}, () => false), true);
    assert.equal(
      providerReady("command", { command: { bin: "codex" } }, {}, cmd => cmd === "codex"),
      true,
    );
    assert.equal(
      providerReady("command", { command: { bin: "missing" } }, {}, () => false),
      false,
    );
  });
});

describe("defaultModelForProvider", () => {
  it("pins Gemini to a stable model instead of the preview default", () => {
    assert.equal(defaultModelForProvider("gemini"), "flash");
  });
});

describe("cliProviderChildEnv", () => {
  it("clears active session markers before spawning a nested CLI provider", () => {
    assert.deepEqual(cliProviderChildEnv("claude"), {
      CLAUDECODE: undefined,
      CLAUDE_CODE: undefined,
      CLAUDE_SESSION_ID: undefined,
    });
    assert.deepEqual(cliProviderChildEnv("codex"), {
      CODEX_THREAD_ID: undefined,
      CODEX_CI: undefined,
      CODEX_MANAGED_BY_NPM: undefined,
    });
    assert.deepEqual(cliProviderChildEnv("gemini"), {
      GEMINI_CLI: undefined,
      GEMINI_CLI_SESSION_ID: undefined,
    });
    assert.deepEqual(cliProviderChildEnv("kiro"), {
      KIRO_CLI: undefined,
      KIRO_SESSION_ID: undefined,
    });
    assert.deepEqual(cliProviderChildEnv("anthropic"), {});
  });
});

describe("claudePermissionModeForResponseFormat", () => {
  it("uses planning mode for structured review outputs", () => {
    assert.equal(claudePermissionModeForResponseFormat("json"), "plan");
    assert.equal(claudePermissionModeForResponseFormat("text"), "plan");
  });

  it("uses a non-planning mode for file generation", () => {
    assert.equal(claudePermissionModeForResponseFormat("files"), "dontAsk");
  });
});

describe("claudeEffortForResponseFormat", () => {
  it("uses lower effort for file generation and structured JSON planning", () => {
    assert.equal(claudeEffortForResponseFormat("files"), "low");
    assert.equal(claudeEffortForResponseFormat("json"), "low");
  });

  it("uses medium effort for plain text outputs", () => {
    assert.equal(claudeEffortForResponseFormat("text"), "medium");
  });
});

describe("codexEffortForResponseFormat", () => {
  it("uses medium effort for file generation", () => {
    assert.equal(codexEffortForResponseFormat("files"), "medium");
  });

  it("keeps high effort for non-file outputs", () => {
    assert.equal(codexEffortForResponseFormat("text"), "high");
    assert.equal(codexEffortForResponseFormat("json"), "high");
  });
});

describe("codexSandboxModeForResponseFormat", () => {
  it("uses workspace-write for file-generation slices", () => {
    assert.equal(codexSandboxModeForResponseFormat("files"), "workspace-write");
  });

  it("keeps read-only sandboxes for planning and review slices", () => {
    assert.equal(codexSandboxModeForResponseFormat("text"), "read-only");
    assert.equal(codexSandboxModeForResponseFormat("json"), "read-only");
  });
});

describe("claudeAllowedToolsForResponseFormat", () => {
  it("keeps Claude in read-only repo inspection mode for structured outputs", () => {
    assert.deepEqual(
      claudeAllowedToolsForResponseFormat("files"),
      ["Read", "Glob", "Grep", "LS", "Task"],
    );
    assert.deepEqual(
      claudeAllowedToolsForResponseFormat("json"),
      [],
    );
  });

  it("does not constrain generic text mode with a read-only tool list", () => {
    assert.deepEqual(claudeAllowedToolsForResponseFormat("text"), []);
  });
});

describe("claudeToolsForResponseFormat", () => {
  it("disables Claude tools entirely for structured JSON planning", () => {
    assert.equal(claudeToolsForResponseFormat("json"), "");
  });

  it("leaves normal tool selection unchanged for other response formats", () => {
    assert.equal(claudeToolsForResponseFormat("files"), null);
    assert.equal(claudeToolsForResponseFormat("text"), null);
  });
});

describe("buildClaudeCliArgs", () => {
  it("adds a read-only tool set for file generation", () => {
    const args = buildClaudeCliArgs({ model: "sonnet", responseFormat: "files" });
    assert.deepEqual(args, [
      "-p",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      "--effort",
      "low",
      "--output-format",
      "text",
      "--allowedTools",
      "Read,Glob,Grep,LS,Task",
      "--model",
      "sonnet",
    ]);
  });

  it("selects a native Claude agent when requested", () => {
    const args = buildClaudeCliArgs({
      model: "sonnet",
      responseFormat: "json",
      agent: "shipflow-strategy-lead",
    });
    assert.deepEqual(args, [
      "-p",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      "--effort",
      "low",
      "--output-format",
      "text",
      "--tools",
      "",
      "--agent",
      "shipflow-strategy-lead",
      "--model",
      "sonnet",
    ]);
  });

  it("passes the prompt as a positional argument for Claude print mode", () => {
    const args = buildClaudeCliArgs({
      model: "sonnet",
      responseFormat: "json",
      prompt: "Return OK",
    });
    assert.deepEqual(args, [
      "-p",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      "--effort",
      "low",
      "--output-format",
      "text",
      "--tools",
      "",
      "--model",
      "sonnet",
      "Return OK",
    ]);
  });

  it("uses native Claude JSON mode with a schema when provided", () => {
    const args = buildClaudeCliArgs({
      model: "sonnet",
      responseFormat: "json",
      jsonSchema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    });
    assert.deepEqual(args, [
      "-p",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      "--effort",
      "low",
      "--output-format",
      "json",
      "--tools",
      "",
      "--json-schema",
      "{\"type\":\"object\",\"properties\":{\"ok\":{\"type\":\"boolean\"}},\"required\":[\"ok\"]}",
      "--model",
      "sonnet",
    ]);
  });
});

describe("buildKiroCliArgs", () => {
  it("runs Kiro headless with native tool trust", () => {
    const args = buildKiroCliArgs({ prompt: "fix it" });
    assert.deepEqual(args, [
      "chat",
      "--no-interactive",
      "--trust-all-tools",
      "--wrap",
      "never",
      "fix it",
    ]);
  });

  it("selects a native Kiro agent when requested", () => {
    const args = buildKiroCliArgs({
      agent: "shipflow-api-specialist",
      prompt: "repair the API slice",
    });
    assert.deepEqual(args, [
      "chat",
      "--no-interactive",
      "--trust-all-tools",
      "--wrap",
      "never",
      "--agent",
      "shipflow-api-specialist",
      "repair the API slice",
    ]);
  });
});

describe("buildGeminiCliArgs", () => {
  it("runs Gemini headless with the ShipFlow extension only", () => {
    const args = buildGeminiCliArgs({});
    assert.deepEqual(args, [
      "--prompt",
      "",
      "--approval-mode",
      "plan",
      "--output-format",
      "text",
      "--extensions",
      "shipflow",
    ]);
  });

  it("passes an explicit model when configured", () => {
    const args = buildGeminiCliArgs({ model: "gemini-2.5-pro" });
    assert.deepEqual(args, [
      "--prompt",
      "",
      "--approval-mode",
      "plan",
      "--output-format",
      "text",
      "--extensions",
      "shipflow",
      "--model",
      "gemini-2.5-pro",
    ]);
  });
});

describe("normalizeProviderText", () => {
  it("extracts fenced JSON cleanly", () => {
    const raw = 'Here you go:\n```json\n{"summary":"ok","proposals":[]}\n```\nDone.';
    assert.equal(normalizeProviderText(raw, "json"), '{"summary":"ok","proposals":[]}');
  });

  it("extracts file blocks from fenced output", () => {
    const raw = "```text\n--- FILE: src/app.js ---\nconsole.log('ok');\n--- END FILE ---\n```";
    assert.equal(
      normalizeProviderText(raw, "files"),
      "--- FILE: src/app.js ---\nconsole.log('ok');\n--- END FILE ---",
    );
  });

  it("normalizes ANSI-wrapped loose file block lines", () => {
    const raw = "\u001b[35m━━━━━━━━ FILE: src/x.txt ---\u001b[0m\nok\n\u001b[35m━━━━━━━━ END FILE ---\u001b[0m";
    assert.equal(
      normalizeProviderText(raw, "files"),
      "--- FILE: src/x.txt ---\nok\n--- END FILE ---",
    );
  });
});

describe("extractClaudeCliText", () => {
  it("unwraps Claude structured_output envelopes when JSON schema mode is enabled", () => {
    const result = {
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        structured_output: { ok: true },
        result: "",
      }),
      stderr: "",
    };
    assert.equal(
      extractClaudeCliText(result, "json", true),
      "{\"ok\":true}",
    );
  });
});

describe("provider command buffering", () => {
  it("uses an explicit provider buffer larger than Node's default spawnSync limit", () => {
    assert.ok(DEFAULT_PROVIDER_MAX_BUFFER_BYTES >= 16 * 1024 * 1024);
  });
});
