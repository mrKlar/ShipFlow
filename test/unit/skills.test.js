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
    "codex-skills/shipflow-draft/SKILL.md",
    "codex-skills/shipflow-implement/SKILL.md",
    "codex-skills/shipflow-impl/SKILL.md",
    "kiro-skills/shipflow-draft/SKILL.md",
    "kiro-skills/shipflow-implement/SKILL.md",
    "kiro-skills/shipflow-impl/SKILL.md",
  ].map(rel => path.join(repoRoot, rel));

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
  });
});
