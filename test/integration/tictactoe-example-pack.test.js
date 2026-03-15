import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gen } from "../../lib/gen.js";
import { runLint } from "../../lib/lint.js";
import { createTempTicTacToeExampleProject } from "../support/tictactoe-example.js";

describe("tic-tac-toe example pack", () => {
  it("lints and generates the committed verification pack", async () => {
    const tmpDir = createTempTicTacToeExampleProject();
    try {
      for (const rel of [
        "vp/ui/show-score-history.yml",
        "vp/ui/play-winning-game.yml",
        "vp/api/record-completed-game.yml",
        "vp/api/get-score-history.yml",
        "vp/behavior/query-score-history.yml",
        "vp/behavior/persist-score-history-after-restart.yml",
        "vp/db/score-history.yml",
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
