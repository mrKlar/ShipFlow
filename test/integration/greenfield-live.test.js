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
    const provider = process.env.SHIPFLOW_LIVE_PROVIDER || "claude";
    const args = [path.join(exampleDir, "run-claude-live.mjs"), "--keep", `--provider=${provider}`];
    if (process.env.SHIPFLOW_LIVE_AI_DRAFT === "1") args.push("--ai-draft");
    if (process.env.SHIPFLOW_LIVE_MODEL) args.push(`--model=${process.env.SHIPFLOW_LIVE_MODEL}`);

    const result = spawnSync(process.execPath, args, {
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
