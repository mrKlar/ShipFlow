import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf-8");
}

describe("live example harnesses", () => {
  it("observe ShipFlow evidence instead of re-implementing hidden acceptance gates", () => {
    const files = [
      "examples/todo-app/run-claude-live.mjs",
      "examples/tic-tac-toe-app/run-live.mjs",
      "examples/movie-comments-app/run-live.mjs",
    ];

    for (const relPath of files) {
      const source = read(relPath);
      assert.match(source, /evidence[\\/]",?\s*"run\.json|evidence[\\/].*run\.json|run\.json/);
      assert.doesNotMatch(source, /assert(?:Todo|TicTacToe|MovieComments)App(?:Runtime)?Quality/);
      assert.doesNotMatch(source, /quality gate/i);
    }
  });
});
