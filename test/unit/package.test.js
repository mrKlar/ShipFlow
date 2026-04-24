import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    stdio: "pipe",
    ...options,
  });
}

describe("repository/package hygiene", () => {
  it("keeps scaffold and example verification packs visible to git", () => {
    for (const rel of [
      "templates/scaffolds/node-web-rest-sqlite/vp/ui/root-shell.yml",
      "templates/scaffolds/node-rest-service-sqlite/vp/api/health.yml",
      "examples/movie-comments-app/vp/domain/movie.yml",
      "examples/tic-tac-toe-app/vp/domain/completed-game.yml",
    ]) {
      assert.equal(fs.existsSync(path.join(repoRoot, rel)), true, `${rel} should exist`);
      if (fs.existsSync(path.join(repoRoot, ".git"))) {
        const ignored = run("git", ["check-ignore", "-q", rel]);
        assert.notEqual(ignored.status, 0, `${rel} should not be ignored`);
      }
    }
  });

  it("allowlists durable npm package content", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
    const files = pkg.files || [];
    const forbidden = [".codex/", ".gen/", ".shipflow/", "evidence/", "node_modules/", "examples/"];
    assert.equal(files.some(file => forbidden.some(prefix => file.startsWith(prefix))), false);
    assert.ok(files.includes("templates/"));
    assert.ok(files.includes("codex-skills/"));
    assert.ok(files.includes("docs/"));
    assert.ok(files.includes("install.sh"));
    assert.ok(files.includes("uninstall.sh"));
  });
});
