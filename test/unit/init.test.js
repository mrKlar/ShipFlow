import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../../lib/init.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("init", () => {
  it("creates vp/ subdirectories", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir });
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "ui", "_fixtures")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "behavior")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "api")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "db")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "nfr")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "policy")));
    });
  });

  it("creates shipflow.json", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir });
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, "shipflow.json"), "utf-8"));
      assert.equal(config.impl.srcDir, "src");
    });
  });

  it("creates CLAUDE.md from template (default platform)", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir });
      assert.ok(fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
      const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
      assert.ok(content.includes("ShipFlow"));
    });
  });

  it("creates .claude/hooks.json (default platform)", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir });
      assert.ok(fs.existsSync(path.join(tmpDir, ".claude", "hooks.json")));
      const hooks = JSON.parse(fs.readFileSync(path.join(tmpDir, ".claude", "hooks.json"), "utf-8"));
      assert.ok(hooks.hooks.PreToolUse);
      assert.ok(hooks.hooks.Stop);
    });
  });

  it("creates .gitignore with .gen/ and evidence/", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir });
      const gi = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
      assert.ok(gi.includes(".gen/"));
      assert.ok(gi.includes("evidence/"));
    });
  });

  it("does not overwrite existing files", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "custom content");
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), '{"custom": true}');
      init({ cwd: tmpDir });
      assert.equal(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8"), "custom content");
      assert.equal(fs.readFileSync(path.join(tmpDir, "shipflow.json"), "utf-8"), '{"custom": true}');
    });
  });

  it("appends to existing .gitignore", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\n");
      init({ cwd: tmpDir });
      const gi = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
      assert.ok(gi.includes("node_modules/"));
      assert.ok(gi.includes(".gen/"));
    });
  });

  // --- Multi-platform tests ---

  it("creates Codex CLI files with --codex platform", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir, platforms: ["codex"] });
      // Codex files created
      assert.ok(fs.existsSync(path.join(tmpDir, "AGENTS.md")));
      const agents = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
      assert.ok(agents.includes("ShipFlow"));
      assert.ok(fs.existsSync(path.join(tmpDir, ".codex", "config.toml")));
      const toml = fs.readFileSync(path.join(tmpDir, ".codex", "config.toml"), "utf-8");
      assert.ok(toml.includes("sandbox_mode"));
      assert.ok(fs.existsSync(path.join(tmpDir, ".codex", "rules", "shipflow.rules")));
      // Claude files NOT created
      assert.ok(!fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
      assert.ok(!fs.existsSync(path.join(tmpDir, ".claude", "hooks.json")));
    });
  });

  it("creates Gemini CLI files with --gemini platform", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir, platforms: ["gemini"] });
      // Gemini files created
      assert.ok(fs.existsSync(path.join(tmpDir, "GEMINI.md")));
      const gemini = fs.readFileSync(path.join(tmpDir, "GEMINI.md"), "utf-8");
      assert.ok(gemini.includes("ShipFlow"));
      assert.ok(fs.existsSync(path.join(tmpDir, ".gemini", "settings.json")));
      const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, ".gemini", "settings.json"), "utf-8"));
      assert.ok(settings.hooks.BeforeTool);
      // Claude files NOT created
      assert.ok(!fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
    });
  });

  it("creates files for all platforms combined", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir, platforms: ["claude", "codex", "gemini"] });
      assert.ok(fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
      assert.ok(fs.existsSync(path.join(tmpDir, ".claude", "hooks.json")));
      assert.ok(fs.existsSync(path.join(tmpDir, "AGENTS.md")));
      assert.ok(fs.existsSync(path.join(tmpDir, ".codex", "config.toml")));
      assert.ok(fs.existsSync(path.join(tmpDir, "GEMINI.md")));
      assert.ok(fs.existsSync(path.join(tmpDir, ".gemini", "settings.json")));
    });
  });
});
