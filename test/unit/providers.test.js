import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeProviderText, providerReady, resolveAutoProvider } from "../../lib/providers/index.js";

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
});
