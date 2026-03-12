import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetTicTacToeRuntimeState, resolveTicTacToeDevPort } from "../support/tictactoe-example.js";

describe("tic-tac-toe example runtime quality support", () => {
  it("clears SQLite runtime state before the quality gate runs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-tictactoe-state-"));
    try {
      for (const suffix of ["", "-shm", "-wal"]) {
        fs.writeFileSync(path.join(tmpDir, `test.db${suffix}`), "dirty");
      }

      resetTicTacToeRuntimeState(tmpDir);

      for (const suffix of ["", "-shm", "-wal"]) {
        assert.equal(fs.existsSync(path.join(tmpDir, `test.db${suffix}`)), false);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("derives the actual runtime port from the dev script when it is pinned inline", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-tictactoe-port-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        scripts: {
          dev: "PORT=45443 node src/server.js",
        },
      }, null, 2));
      assert.equal(resolveTicTacToeDevPort(tmpDir, 46039), 45443);
      assert.equal(resolveTicTacToeDevPort(path.join(tmpDir, "missing"), 46039), 46039);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
