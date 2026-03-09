import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(__dirname, "../../examples/todo-app");

describe("greenfield live example", () => {
  it("runs the real Claude todo example when explicitly enabled", {
    timeout: 60 * 60 * 1000,
    skip: process.env.SHIPFLOW_RUN_LIVE_GREENFIELD !== "1",
  }, () => {
    const result = spawnSync(process.execPath, [path.join(exampleDir, "run-claude-live.mjs"), "--keep"], {
      cwd: exampleDir,
      encoding: "utf-8",
      stdio: "pipe",
      env: process.env,
    });

    assert.equal(
      result.status,
      0,
      `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
    );
  });
});
