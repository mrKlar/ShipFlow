import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function parseFrontmatter(file) {
  const source = fs.readFileSync(file, "utf-8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `Missing frontmatter in ${path.relative(repoRoot, file)}`);
  return yaml.load(match[1]);
}

describe("native delegation assets", () => {
  const specialistNames = [
    "shipflow-strategy-lead",
    "shipflow-architecture-specialist",
    "shipflow-ui-specialist",
    "shipflow-api-specialist",
    "shipflow-database-specialist",
    "shipflow-security-specialist",
    "shipflow-technical-specialist",
  ];

  it("ships Claude native subagents with frontmatter", () => {
    for (const name of specialistNames) {
      const file = path.join(repoRoot, "claude-agents", `${name}.md`);
      assert.ok(fs.existsSync(file), `Missing Claude agent ${name}`);
      const frontmatter = parseFrontmatter(file);
      assert.equal(frontmatter.name, name);
      assert.equal(typeof frontmatter.description, "string");
    }
  });

  it("ships Kiro native custom agents with frontmatter", () => {
    for (const name of specialistNames) {
      const file = path.join(repoRoot, "kiro-agents", `${name}.md`);
      assert.ok(fs.existsSync(file), `Missing Kiro agent ${name}`);
      const frontmatter = parseFrontmatter(file);
      assert.equal(frontmatter.name, name);
      assert.equal(typeof frontmatter.description, "string");
    }
  });

  it("ships Gemini native specialist commands", () => {
    const commandNames = [
      "strategy-lead",
      "architecture-specialist",
      "ui-specialist",
      "api-specialist",
      "database-specialist",
      "security-specialist",
      "technical-specialist",
    ];
    for (const name of commandNames) {
      const file = path.join(repoRoot, "gemini-extension", "commands", "shipflow", `${name}.toml`);
      assert.ok(fs.existsSync(file), `Missing Gemini command ${name}`);
      const source = fs.readFileSync(file, "utf-8");
      assert.match(source, /{{args}}/);
    }
  });

  it("installs native paths instead of generic ones", () => {
    const source = fs.readFileSync(path.join(repoRoot, "install.sh"), "utf-8");
    assert.match(source, /~\/\.claude\/agents\/shipflow-\*\.md/);
    assert.match(source, /~\/\.codex\/skills/);
    assert.match(source, /~\/\.kiro\/agents\/shipflow-\*\.md/);
    assert.match(source, /\/shipflow:strategy-lead/);
    assert.doesNotMatch(source, /~\/\.agents\/skills/);
    assert.doesNotMatch(source, /shipflow-\*\.json/);
  });

  it("removes generic support wording from provider templates", () => {
    for (const file of [
      path.join(repoRoot, "templates", "AGENTS.md"),
      path.join(repoRoot, "templates", "CLAUDE.md"),
      path.join(repoRoot, "templates", "GEMINI.md"),
      path.join(repoRoot, "templates", "KIRO.md"),
      path.join(repoRoot, "codex-skills", "shipflow-implement", "SKILL.md"),
      path.join(repoRoot, "kiro-skills", "shipflow-implement", "SKILL.md"),
    ]) {
      const source = fs.readFileSync(file, "utf-8");
      assert.doesNotMatch(source, /If your CLI supports subagents/i);
      assert.doesNotMatch(source, /If the CLI supports subagents/i);
    }
  });

  it("ships Codex native multi-agent project templates", () => {
    const config = fs.readFileSync(path.join(repoRoot, "templates", "codex-config.toml"), "utf-8");
    assert.match(config, /\[features\]/);
    assert.match(config, /multi_agent = true/);
    assert.match(config, /\[agents\.shipflow_strategy_lead\]/);
    assert.ok(fs.existsSync(path.join(repoRoot, "templates", "codex-agents", "strategy-lead.toml")));
    assert.ok(fs.existsSync(path.join(repoRoot, "templates", "codex-agents", "api-specialist.toml")));
  });

  it("ships Codex strategy and specialist sandboxes with the intended write model", () => {
    const strategy = fs.readFileSync(path.join(repoRoot, "templates", "codex-agents", "strategy-lead.toml"), "utf-8");
    assert.match(strategy, /sandbox_mode = "read-only"/);

    for (const name of [
      "architecture-specialist.toml",
      "ui-specialist.toml",
      "api-specialist.toml",
      "database-specialist.toml",
      "security-specialist.toml",
      "technical-specialist.toml",
    ]) {
      const source = fs.readFileSync(path.join(repoRoot, "templates", "codex-agents", name), "utf-8");
      assert.match(source, /sandbox_mode = "workspace-write"/, `${name} should be writable`);
      assert.doesNotMatch(source, /sandbox_mode = "read-only"/, `${name} should not be read-only`);
    }
  });
});
