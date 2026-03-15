import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gen } from "../../lib/gen.js";
import { impl } from "../../lib/impl.js";
import { runLint } from "../../lib/lint.js";
import { createTempTodoExampleProject, todoExampleImplementationFileBlocks } from "../support/todo-example.js";

describe("todo example temp project", () => {
  it("implements the canonical todo app in a temporary directory", async () => {
    const tmpDir = createTempTodoExampleProject();
    try {
      for (const rel of [
        "vp/ui/add-todo.yml",
        "vp/ui/complete-todo.yml",
        "vp/ui/filter-todos.yml",
        "vp/api/post-todos.yml",
        "vp/api/get-todos.yml",
        "vp/api/patch-todo-completed.yml",
        "vp/behavior/get-api-todos-flow.yml",
        "vp/behavior/persist-todos-after-restart.yml",
        "vp/db/todos-state.yml",
      ]) {
        assert.equal(fs.existsSync(path.join(tmpDir, rel)), true, `${rel} should be part of the example pack`);
      }

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
      assert.equal(fs.existsSync(path.join(tmpDir, "src", "server.js")), true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
