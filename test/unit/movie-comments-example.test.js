import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetMovieCommentsRuntimeState, resolveMovieCommentsDevPort } from "../support/movie-comments-example.js";

describe("movie-comments example runtime quality support", () => {
  it("clears SQLite runtime state and reseeds the movie catalog before the quality gate runs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-movie-comments-state-"));
    try {
      for (const suffix of ["", "-shm", "-wal"]) {
        fs.writeFileSync(path.join(tmpDir, `test.db${suffix}`), "dirty");
      }

      resetMovieCommentsRuntimeState(tmpDir);

      assert.equal(fs.existsSync(path.join(tmpDir, "test.db")), true);
      assert.equal(fs.existsSync(path.join(tmpDir, "test.db-shm")), false);
      assert.equal(fs.existsSync(path.join(tmpDir, "test.db-wal")), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("derives the actual runtime port from the dev script when it is pinned inline", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-movie-comments-port-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        scripts: {
          dev: "PORT=45443 node src/server.js",
        },
      }, null, 2));
      assert.equal(resolveMovieCommentsDevPort(tmpDir, 46039), 45443);
      assert.equal(resolveMovieCommentsDevPort(path.join(tmpDir, "missing"), 46039), 46039);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
