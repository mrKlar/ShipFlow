import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  buildMovieCommentsLiveArgs,
  movieCommentsLiveExampleDir,
  resolveMovieCommentsLiveProviders,
} from "../support/movie-comments-live.js";

function runMovieCommentsLiveProvider(provider, env = process.env) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(process.execPath, buildMovieCommentsLiveArgs(provider, env), {
      cwd: movieCommentsLiveExampleDir,
      env: {
        ...env,
        SHIPFLOW_LIVE_MAX_ITERATIONS: env.SHIPFLOW_LIVE_MAX_ITERATIONS || "1",
        PATH: [path.dirname(process.execPath), env.PATH || ""].filter(Boolean).join(path.delimiter),
      },
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

const enabled = process.env.SHIPFLOW_RUN_LIVE_MOVIE_COMMENTS === "1";
const providers = enabled ? resolveMovieCommentsLiveProviders() : [];

describe("movie-comments live cli matrix", { concurrency: true }, () => {
  if (!enabled) {
    it("is disabled unless SHIPFLOW_RUN_LIVE_MOVIE_COMMENTS=1", { skip: true }, () => {});
    return;
  }

  if (providers.length === 0) {
    it("requires at least one installed provider CLI", { skip: true }, () => {});
    return;
  }

  for (const provider of providers) {
    it(`runs the movie-comments live workflow with ${provider}`, { timeout: 60 * 60 * 1000 }, async () => {
      const result = await runMovieCommentsLiveProvider(provider);
      assert.equal(
        result.code,
        0,
        `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
      );
    });
  }
});
