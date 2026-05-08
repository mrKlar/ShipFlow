import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  detectMigrations,
  applyMigrations,
  migrateCli,
} from "../../lib/migrate.js";
import { withTmpDir as tmpDir } from "../util/tmp.js";
import { captureStdio } from "../util/stdio.js";

const withTmpDir = (fn) => tmpDir("shipflow-migrate", fn);

describe("migrate", () => {
  it("detects no migrations needed on a fresh repo", () => {
    withTmpDir(tmp => {
      const m = detectMigrations(tmp);
      assert.equal(m.length, 0);
    });
  });

  it("detects legacy slice/ files at the repo root", () => {
    withTmpDir(tmp => {
      fs.mkdirSync(path.join(tmp, "slice"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "slice", "a.yml"), "id: a\ngoal: G\n");
      fs.writeFileSync(path.join(tmp, "slice", "b.yml"), "id: b\ngoal: G\n");
      const m = detectMigrations(tmp);
      assert.equal(m.length, 1);
      assert.equal(m[0].id, "slices.move-to-shipflow");
      assert.deepEqual(m[0].files.sort(), ["slice/a.yml", "slice/b.yml"]);
    });
  });

  it("detects blanket .shipflow/ ignore in .gitignore", () => {
    withTmpDir(tmp => {
      fs.writeFileSync(path.join(tmp, ".gitignore"), "node_modules/\n.shipflow/\nevidence/\n");
      const m = detectMigrations(tmp);
      assert.equal(m.length, 1);
      assert.equal(m[0].id, "gitignore.precise-runtime");
    });
  });

  it("does NOT flag a precise .shipflow/runtime/ ignore", () => {
    withTmpDir(tmp => {
      fs.writeFileSync(path.join(tmp, ".gitignore"),
        "node_modules/\n.shipflow/runtime/\n.shipflow/draft-session.json\nevidence/\n");
      const m = detectMigrations(tmp);
      assert.equal(m.length, 0);
    });
  });

  it("applyMigrations moves legacy slices and removes empty slice/", () => {
    withTmpDir(tmp => {
      fs.mkdirSync(path.join(tmp, "slice"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "slice", "a.yml"), "id: a\ngoal: G\n");

      applyMigrations(tmp);

      assert.equal(fs.existsSync(path.join(tmp, "slice")), false,
        "empty slice/ dir should be removed after migration");
      assert.ok(fs.existsSync(path.join(tmp, ".shipflow", "slices", "a.yml")));
    });
  });

  it("applyMigrations rewrites blanket .shipflow/ to the precise list", () => {
    withTmpDir(tmp => {
      fs.writeFileSync(path.join(tmp, ".gitignore"),
        "node_modules/\n.shipflow/\nevidence/\n");
      applyMigrations(tmp);
      const after = fs.readFileSync(path.join(tmp, ".gitignore"), "utf-8");
      assert.equal(after.includes(".shipflow/runtime/"), true);
      assert.equal(after.includes(".shipflow/draft-session.json"), true);
      // blanket line is gone
      assert.equal(/\n\.shipflow\/\n/.test("\n" + after), false);
      // surrounding lines preserved
      assert.match(after, /node_modules\//);
      assert.match(after, /evidence\//);
    });
  });

  it("apply is idempotent (running twice is a no-op)", () => {
    withTmpDir(tmp => {
      fs.mkdirSync(path.join(tmp, "slice"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "slice", "a.yml"), "id: a\n");
      applyMigrations(tmp);
      const second = detectMigrations(tmp);
      assert.equal(second.length, 0);
    });
  });

  it("CLI: dry run lists migrations and exits 0 without changing files", () => {
    withTmpDir(tmp => {
      fs.mkdirSync(path.join(tmp, "slice"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "slice", "a.yml"), "id: a\n");
      const { result, stdout } = captureStdio(() => migrateCli({ cwd: tmp, args: [] }));
      assert.equal(result.exitCode, 0);
      assert.match(stdout, /Pending migrations \(1\)/);
      assert.match(stdout, /Dry-run only/);
      // Files unchanged
      assert.ok(fs.existsSync(path.join(tmp, "slice", "a.yml")));
    });
  });

  it("CLI: --apply moves files and reports success", () => {
    withTmpDir(tmp => {
      fs.mkdirSync(path.join(tmp, "slice"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "slice", "a.yml"), "id: a\n");
      const { result, stdout } = captureStdio(() => migrateCli({ cwd: tmp, args: ["--apply"] }));
      assert.equal(result.exitCode, 0);
      assert.match(stdout, /Applied 1 migration/);
      assert.ok(fs.existsSync(path.join(tmp, ".shipflow", "slices", "a.yml")));
    });
  });

  it("CLI: --json --apply emits structured result", () => {
    withTmpDir(tmp => {
      fs.mkdirSync(path.join(tmp, "slice"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "slice", "a.yml"), "id: a\n");
      const { result, stdout } = captureStdio(() => migrateCli({
        cwd: tmp,
        args: ["--apply"],
        json: true,
      }));
      assert.equal(result.exitCode, 0);
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.mode, "apply");
      assert.ok(Array.isArray(parsed.applied));
      assert.equal(parsed.applied.length, 1);
      assert.equal(parsed.applied[0].id, "slices.move-to-shipflow");
    });
  });

  it("CLI: --json dry-run emits the pending list", () => {
    withTmpDir(tmp => {
      fs.mkdirSync(path.join(tmp, "slice"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "slice", "a.yml"), "id: a\n");
      const { result, stdout } = captureStdio(() => migrateCli({
        cwd: tmp,
        args: [],
        json: true,
      }));
      assert.equal(result.exitCode, 0);
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.mode, "dry-run");
      assert.ok(Array.isArray(parsed.pending));
      assert.equal(parsed.pending.length, 1);
    });
  });

  it("aborts when destination already exists", () => {
    withTmpDir(tmp => {
      fs.mkdirSync(path.join(tmp, "slice"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "slice", "a.yml"), "id: a\n");
      // Pre-create a file at the destination to force a conflict
      fs.mkdirSync(path.join(tmp, ".shipflow", "slices"), { recursive: true });
      fs.writeFileSync(path.join(tmp, ".shipflow", "slices", "a.yml"), "id: existing\n");
      assert.throws(() => applyMigrations(tmp), /already exists/);
    });
  });
});
