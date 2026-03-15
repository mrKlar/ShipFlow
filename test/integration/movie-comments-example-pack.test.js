import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gen } from "../../lib/gen.js";
import { runLint } from "../../lib/lint.js";
import { createTempMovieCommentsExampleProject } from "../support/movie-comments-example.js";

describe("movie-comments example pack", () => {
  it("lints and generates the committed verification pack", async () => {
    const tmpDir = createTempMovieCommentsExampleProject();
    try {
      for (const rel of [
        "vp/ui/show-persisted-comment.yml",
        "vp/ui/post-movie-comment.yml",
        "vp/api/get-movie-detail.yml",
        "vp/api/add-movie-comment.yml",
        "vp/behavior/query-movie-comments.yml",
        "vp/behavior/persist-movie-comments-after-restart.yml",
        "vp/db/movie-comments.yml",
      ]) {
        assert.equal(fs.existsSync(path.join(tmpDir, rel)), true, `${rel} should be part of the example pack`);
      }

      const lint = runLint(tmpDir);
      assert.equal(lint.ok, true);

      await gen({ cwd: tmpDir });
      const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, ".gen", "manifest.json"), "utf-8"));
      assert.equal(manifest.outputs.ui.count, 2);
      assert.equal(manifest.outputs.behavior.count, 0);
      assert.equal(manifest.outputs.behavior_gherkin.count, 2);
      assert.equal(manifest.outputs.domain.count, 1);
      assert.equal(manifest.outputs.api.count, 2);
      assert.equal(manifest.outputs.db.count, 1);
      assert.equal(manifest.outputs.technical.count, 3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
