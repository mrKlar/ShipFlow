import { describe, it } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  buildTictactoeLiveArgs,
  buildTictactoeLiveEnv,
  resolveTictactoeLiveProviders,
  tictactoeLiveExampleDir,
} from "../support/tictactoe-live.js";

function runTictactoeLiveProvider(provider, env = process.env) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(process.execPath, buildTictactoeLiveArgs(provider, env), {
      cwd: tictactoeLiveExampleDir,
      env: buildTictactoeLiveEnv(env, process.execPath),
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf-8"),
        stderr: Buffer.concat(stderr).toString("utf-8"),
      });
    });
  });
}

const enabled = process.env.SHIPFLOW_RUN_LIVE_TICTACTOE === "1";
const providers = enabled ? resolveTictactoeLiveProviders() : [];

describe("tic-tac-toe live cli matrix", { concurrency: true }, () => {
  if (!enabled) {
    it("is disabled unless SHIPFLOW_RUN_LIVE_TICTACTOE=1", { skip: true }, () => {});
    return;
  }

  if (providers.length === 0) {
    it("requires at least one installed provider CLI", { skip: true }, () => {});
    return;
  }

  for (const provider of providers) {
    it(`runs the tic-tac-toe live workflow with ${provider}`, { timeout: 60 * 60 * 1000 }, async () => {
      const result = await runTictactoeLiveProvider(provider);
      assert.equal(
        result.code,
        0,
        `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
      );
    });
  }
});
