import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const bashGuard = path.join(repoRoot, "hooks", "claude-bash-guard.js");

function runHook(payload) {
  try {
    execFileSync("node", [bashGuard], {
      input: JSON.stringify(payload),
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stderr: String(error.stderr || ""),
    };
  }
}

describe("claude bash guard", () => {
  it("allows direct shipflow commands", () => {
    const result = runHook({
      tool_input: {
        command: "shipflow draft --json \"todo app\"",
      },
    });
    assert.equal(result.code, 0);
  });

  it("blocks introspection of the installed shipflow binary", () => {
    const result = runHook({
      tool_input: {
        command: "cat ~/.local/bin/shipflow | head -5",
      },
    });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /do not inspect the installed ShipFlow package/i);
  });

  it("blocks shell substitution used to locate ShipFlow examples", () => {
    const result = runHook({
      tool_input: {
        command: "SHIPFLOW_PKG=$(dirname $(realpath ~/.local/bin/shipflow))/..; ls $SHIPFLOW_PKG/examples/",
      },
    });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /use `shipflow draft --json` as the source of truth/i);
  });
});
