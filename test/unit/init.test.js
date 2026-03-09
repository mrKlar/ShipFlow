import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init, recommendedPlatforms } from "../../lib/init.js";

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
      init({ cwd: tmpDir, deps: { env: {}, commandExists: () => false } });
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "ui", "_fixtures")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "behavior")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "api")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "db")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "nfr")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "security")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "technical")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "policy")));
    });
  });

  it("creates shipflow.json", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir, deps: { env: {}, commandExists: () => false } });
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, "shipflow.json"), "utf-8"));
      assert.equal(config.draft.provider, "local");
      assert.equal(config.draft.aiProvider, "auto");
      assert.equal(config.impl.provider, "auto");
      assert.equal(config.impl.historyLimit, 50);
      assert.equal(Object.prototype.hasOwnProperty.call(config.impl, "model"), false);
      assert.equal(config.impl.srcDir, "src");
    });
  });

  it("seeds a brownfield draft session with discovered verification types", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), `
        app.get("/dashboard", handler);
        app.get("/api/users", handler);
        const sql = "SELECT * FROM users";
        const auth = req.headers.authorization;
      `);
      fs.writeFileSync(path.join(tmpDir, ".github", "workflows", "ci.yml"), "uses: actions/checkout@v4\n");
      init({ cwd: tmpDir, deps: { env: {}, commandExists: () => false } });

      const session = JSON.parse(fs.readFileSync(path.join(tmpDir, ".shipflow", "draft-session.json"), "utf-8"));
      const types = new Set(session.proposals.map(proposal => proposal.type));
      assert.ok(types.has("ui"));
      assert.ok(types.has("behavior"));
      assert.ok(types.has("api"));
      assert.ok(types.has("database"));
      assert.ok(types.has("performance"));
      assert.ok(types.has("security"));
      assert.ok(types.has("technical"));
    });
  });

  it("creates CLAUDE.md from template (default platform)", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir, deps: { env: {}, commandExists: () => false } });
      assert.ok(fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
      const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
      assert.ok(content.includes("ShipFlow"));
    });
  });

  it("creates .claude/hooks.json (default platform)", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir, deps: { env: {}, commandExists: () => false } });
      assert.ok(fs.existsSync(path.join(tmpDir, ".claude", "hooks.json")));
      const hooks = JSON.parse(fs.readFileSync(path.join(tmpDir, ".claude", "hooks.json"), "utf-8"));
      assert.ok(hooks.hooks.PreToolUse);
      assert.ok(hooks.hooks.PreToolUse.some(hook => hook.matcher === "Bash" && hook.command === "shipflow-bash-guard"));
      assert.ok(hooks.hooks.PreToolUse.some(hook => hook.matcher === "Edit|Write"));
      assert.ok(hooks.hooks.Stop);
    });
  });

  it("merges new Claude hooks into an existing hooks.json", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".claude", "hooks.json"), JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Read", command: "custom-read-hook" }],
          Stop: [{ command: "custom-stop-hook" }],
        },
      }, null, 2));

      init({ cwd: tmpDir, deps: { env: {}, commandExists: () => false } });

      const hooks = JSON.parse(fs.readFileSync(path.join(tmpDir, ".claude", "hooks.json"), "utf-8"));
      assert.ok(hooks.hooks.PreToolUse.some(hook => hook.matcher === "Read" && hook.command === "custom-read-hook"));
      assert.ok(hooks.hooks.PreToolUse.some(hook => hook.matcher === "Bash" && hook.command === "shipflow-bash-guard"));
      assert.ok(hooks.hooks.PreToolUse.some(hook => hook.matcher === "Edit|Write"));
      assert.ok(hooks.hooks.Stop.some(hook => hook.command === "custom-stop-hook"));
      assert.ok(
        hooks.hooks.Stop.some(hook =>
          hook.command === "shipflow-stop"
          || String(hook.command || "").includes("stop-verify.js")
        )
      );
    });
  });

  it("creates .gitignore with ShipFlow working directories", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir, deps: { env: {}, commandExists: () => false } });
      const gi = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
      assert.ok(gi.includes(".gen/"));
      assert.ok(gi.includes(".shipflow/"));
      assert.ok(gi.includes("evidence/"));
    });
  });

  it("does not overwrite existing files", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "custom content");
      fs.writeFileSync(path.join(tmpDir, "shipflow.json"), '{"custom": true}');
      init({ cwd: tmpDir, deps: { env: {}, commandExists: () => false } });
      assert.equal(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8"), "custom content");
      assert.equal(fs.readFileSync(path.join(tmpDir, "shipflow.json"), "utf-8"), '{"custom": true}');
    });
  });

  it("appends to existing .gitignore", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\n");
      init({ cwd: tmpDir, deps: { env: {}, commandExists: () => false } });
      const gi = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
      assert.ok(gi.includes("node_modules/"));
      assert.ok(gi.includes(".gen/"));
      assert.ok(gi.includes(".shipflow/"));
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
      assert.ok(toml.includes("\"vp/\""));
      assert.ok(toml.includes("\".shipflow/\""));
      assert.ok(fs.existsSync(path.join(tmpDir, ".codex", "rules", "shipflow.rules")));
      const rules = fs.readFileSync(path.join(tmpDir, ".codex", "rules", "shipflow.rules"), "utf-8");
      assert.ok(rules.includes('pattern=["cat", ["~/.local/bin/shipflow"'));
      assert.ok(rules.includes('pattern=["find", ["~/.claude/plugins"'));
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
      assert.ok(settings.hooks.BeforeTool.some(hook => hook.matcher === "write_file|replace"));
      assert.ok(settings.hooks.BeforeTool.some(hook => hook.matcher === "run_shell_command|shell"));
      // Claude files NOT created
      assert.ok(!fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
    });
  });

  it("merges Gemini shell and write guards into an existing settings.json", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, ".gemini"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".gemini", "settings.json"), JSON.stringify({
        hooks: {
          BeforeTool: [{
            matcher: "custom",
            hooks: [{ name: "custom-hook", type: "command", command: "custom-cmd", timeout: 1000 }],
          }],
        },
      }, null, 2));

      init({ cwd: tmpDir, platforms: ["gemini"] });

      const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, ".gemini", "settings.json"), "utf-8"));
      assert.ok(settings.hooks.BeforeTool.some(hook => hook.matcher === "custom"));
      assert.ok(settings.hooks.BeforeTool.some(hook => hook.matcher === "write_file|replace"));
      assert.ok(settings.hooks.BeforeTool.some(hook => hook.matcher === "run_shell_command|shell"));
    });
  });

  it("creates files for all platforms combined", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir, platforms: ["claude", "codex", "gemini", "kiro"] });
      assert.ok(fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
      assert.ok(fs.existsSync(path.join(tmpDir, ".claude", "hooks.json")));
      assert.ok(fs.existsSync(path.join(tmpDir, "AGENTS.md")));
      assert.ok(fs.existsSync(path.join(tmpDir, ".codex", "config.toml")));
      assert.ok(fs.existsSync(path.join(tmpDir, "GEMINI.md")));
      assert.ok(fs.existsSync(path.join(tmpDir, ".gemini", "settings.json")));
      assert.ok(fs.existsSync(path.join(tmpDir, "KIRO.md")));
    });
  });

  it("recommends the active Codex platform when detected", () => {
    withTmpDir(tmpDir => {
      const platforms = recommendedPlatforms(tmpDir, {
        env: { CODEX_THREAD_ID: "thread-1" },
        commandExists: (cmd) => cmd === "codex",
      });
      assert.deepEqual(platforms, ["codex"]);
    });
  });

  it("falls back to Claude when no active platform is detected", () => {
    withTmpDir(tmpDir => {
      const platforms = recommendedPlatforms(tmpDir, {
        env: {},
        commandExists: () => false,
      });
      assert.deepEqual(platforms, ["claude"]);
    });
  });

  it("recommends all detected installed CLIs when no active platform is signaled", () => {
    withTmpDir(tmpDir => {
      const platforms = recommendedPlatforms(tmpDir, {
        env: {},
        commandExists: (cmd) => cmd === "codex" || cmd === "gemini",
      });
      assert.deepEqual(platforms, ["codex", "gemini"]);
    });
  });

  it("creates active-platform files by default in a Codex session", () => {
    withTmpDir(tmpDir => {
      init({
        cwd: tmpDir,
        deps: {
          env: { CODEX_THREAD_ID: "thread-1" },
          commandExists: (cmd) => cmd === "codex",
        },
      });
      assert.ok(fs.existsSync(path.join(tmpDir, "AGENTS.md")));
      assert.ok(fs.existsSync(path.join(tmpDir, ".codex", "config.toml")));
      assert.ok(!fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
    });
  });

  it("creates KIRO.md from the Kiro template", () => {
    withTmpDir(tmpDir => {
      init({ cwd: tmpDir, platforms: ["kiro"] });
      const kiro = fs.readFileSync(path.join(tmpDir, "KIRO.md"), "utf-8");
      assert.ok(kiro.includes("with Kiro"));
      const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, ".kiro", "settings.json"), "utf-8"));
      assert.ok(settings.hooks.PreToolUse.some(hook => hook.matcher === "write_file|replace"));
      assert.ok(settings.hooks.PreToolUse.some(hook => hook.matcher === "execute_bash|shell"));
      assert.ok(!fs.existsSync(path.join(tmpDir, "CLAUDE.md")));
    });
  });
});
