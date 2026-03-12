import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gen } from "../../lib/gen.js";
import { impl } from "../../lib/impl.js";
import { runLint } from "../../lib/lint.js";
import { assertTodoAppQuality, createTempTodoExampleProject, todoExampleImplementationFileBlocks } from "../support/todo-example.js";

describe("todo example temp project", () => {
  it("implements the canonical todo app in a temporary directory and passes the quality gate", async () => {
    const tmpDir = createTempTodoExampleProject();
    try {
      const lint = runLint(tmpDir);
      assert.equal(lint.ok, true);

      await gen({ cwd: tmpDir });
      const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, ".gen", "manifest.json"), "utf-8"));
      assert.equal(manifest.outputs.ui.count, 3);
      assert.equal(manifest.outputs.api.count, 3);
      assert.equal(manifest.outputs.db.count, 1);
      assert.equal(manifest.outputs.technical.count, 3);

      const implementation = await impl({
        cwd: tmpDir,
        provider: "command",
        deps: {
          generateWithProvider: async () => todoExampleImplementationFileBlocks(),
        },
      });

      const written = Array.isArray(implementation)
        ? implementation
        : implementation?.written;

      assert.deepEqual(written, ["src/server.js"]);
      assert.equal(Array.isArray(implementation?.specialists), true);

      await assertTodoAppQuality(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
