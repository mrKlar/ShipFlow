import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateClaudeBashGuard,
  evaluateGeminiGuard,
  evaluateKiroGuard,
} from "../../hooks/guard-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

describe("claude bash guard", () => {
  it("allows direct shipflow commands", () => {
    const result = evaluateClaudeBashGuard({
      tool_input: {
        command: "shipflow draft --json \"todo app\"",
      },
    });
    assert.equal(result.code, 0);
  });

  it("blocks introspection of the installed shipflow binary", () => {
    const result = evaluateClaudeBashGuard({
      tool_input: {
        command: "cat ~/.local/bin/shipflow | head -5",
      },
    });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /do not inspect the installed ShipFlow package/i);
  });

  it("blocks shell substitution used to locate ShipFlow examples", () => {
    const result = evaluateClaudeBashGuard({
      tool_input: {
        command: "SHIPFLOW_PKG=$(dirname $(realpath ~/.local/bin/shipflow))/..; ls $SHIPFLOW_PKG/examples/",
      },
    });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /use `shipflow draft --json` as the source of truth/i);
  });
});

describe("gemini guard", () => {
  it("blocks shell introspection of installed ShipFlow files", () => {
    const result = evaluateGeminiGuard({
      tool_name: "run_shell_command",
      tool_input: {
        command: "SHIPFLOW_PKG=$(dirname $(realpath ~/.local/bin/shipflow))/..; ls $SHIPFLOW_PKG/examples/",
      },
    }, { cwd: repoRoot });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /do not inspect the installed ShipFlow package/i);
  });

  it("blocks writes to protected verification paths", () => {
    const result = evaluateGeminiGuard({
      tool_name: "write_file",
      tool_input: {
        path: path.join(repoRoot, "vp", "ui", "admin.yml"),
      },
    }, { cwd: repoRoot });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /cannot modify vp\/ui\/admin\.yml/i);
  });
});

describe("kiro guard", () => {
  it("blocks shell introspection of installed ShipFlow files", () => {
    const result = evaluateKiroGuard({
      tool_name: "execute_bash",
      tool_input: {
        command: "cat ~/.local/bin/shipflow | head -5",
      },
    }, { cwd: repoRoot });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /do not inspect the installed ShipFlow package/i);
  });

  it("blocks writes to protected verification paths", () => {
    const result = evaluateKiroGuard({
      tool_name: "write_file",
      tool_input: {
        path: path.join(repoRoot, "evidence", "verify.json"),
      },
    }, { cwd: repoRoot });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /cannot modify evidence\/verify\.json/i);
  });
});
