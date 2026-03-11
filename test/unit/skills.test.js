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

function readSkill(file) {
  return fs.readFileSync(file, "utf-8");
}

describe("ShipFlow skill frontmatter", () => {
  const skillFiles = [
    ...fs.readdirSync(path.join(repoRoot, "codex-skills"))
      .filter(name => name.startsWith("shipflow-"))
      .map(name => path.join(repoRoot, "codex-skills", name, "SKILL.md"))
      .filter(file => fs.existsSync(file)),
    ...fs.readdirSync(path.join(repoRoot, "kiro-skills"))
      .filter(name => name.startsWith("shipflow-"))
      .map(name => path.join(repoRoot, "kiro-skills", name, "SKILL.md"))
      .filter(file => fs.existsSync(file)),
  ];

  for (const file of skillFiles) {
    it(`parses ${path.relative(repoRoot, file)}`, () => {
      const frontmatter = parseFrontmatter(file);
      assert.equal(typeof frontmatter?.name, "string");
      assert.equal(typeof frontmatter?.description, "string");
      assert.ok(frontmatter.description.length > 0);
    });
  }

  it("keeps the Codex draft skill collaborative", () => {
    const source = readSkill(path.join(repoRoot, "codex-skills/shipflow-draft/SKILL.md"));
    assert.match(source, /ask concise clarification questions/i);
    assert.match(source, /reason to abandon the draft workflow/i);
    assert.match(source, /local proposals are first-class/i);
    assert.match(source, /pending by default/i);
    assert.match(source, /foundational hints/i);
  });

  it("keeps the implementation skills honest about broken backends", () => {
    const codex = readSkill(path.join(repoRoot, "codex-skills/shipflow-implement/SKILL.md"));
    const kiro = readSkill(path.join(repoRoot, "kiro-skills/shipflow-implement/SKILL.md"));
    assert.match(codex, /Fix real backend, database, runtime, and dependency failures/i);
    assert.match(codex, /Never hardcode expected outputs, bypass storage, suppress errors, or stub around a broken system/i);
    assert.match(kiro, /Fix real backend, database, runtime, and dependency failures/i);
    assert.match(kiro, /Never hardcode expected outputs, bypass storage, suppress errors, or stub around a broken system/i);
  });
});
