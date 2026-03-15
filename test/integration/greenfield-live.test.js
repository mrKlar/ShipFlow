import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildTodoLiveArgs, todoLiveExampleDir } from "../support/todo-live.js";

describe("greenfield live example", () => {
  it("runs the real provider-backed todo example when explicitly enabled", {
    timeout: 60 * 60 * 1000,
    skip: process.env.SHIPFLOW_RUN_LIVE_GREENFIELD !== "1",
  }, () => {
    const provider = process.env.SHIPFLOW_LIVE_PROVIDER || "claude";
    const args = buildTodoLiveArgs(provider, {
      ...process.env,
      SHIPFLOW_LIVE_KEEP: process.env.SHIPFLOW_LIVE_KEEP || "1",
    });

    const result = spawnSync(process.execPath, args, {
      cwd: todoLiveExampleDir,
      encoding: "utf-8",
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: [path.dirname(process.execPath), process.env.PATH || ""].filter(Boolean).join(path.delimiter),
      },
    });

    assert.equal(
      result.status,
      0,
      `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
    );
  });
});
