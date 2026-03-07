import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gen } from "../../lib/gen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../fixtures");
const genDir = path.join(fixturesDir, ".gen");

describe("gen integration — full cycle on test fixtures", () => {
  before(async () => {
    fs.rmSync(genDir, { recursive: true, force: true });
    await gen({ cwd: fixturesDir });
  });

  after(() => {
    fs.rmSync(genDir, { recursive: true, force: true });
  });

  it("creates .gen directory with playwright subfolder", () => {
    assert.ok(fs.existsSync(genDir));
    assert.ok(fs.existsSync(path.join(genDir, "playwright")));
  });

  it("generates one spec per UI check YAML", () => {
    const specs = fs.readdirSync(path.join(genDir, "playwright")).filter(f => f.endsWith(".spec.ts"));
    assert.equal(specs.length, 3);
  });

  it("generates vp.lock.json with correct structure", () => {
    const lockPath = path.join(genDir, "vp.lock.json");
    assert.ok(fs.existsSync(lockPath));
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    assert.equal(lock.version, 1);
    assert.ok(typeof lock.vp_sha256 === "string");
    assert.ok(lock.vp_sha256.length === 64);
    assert.ok(Array.isArray(lock.files));
    assert.ok(lock.files.length > 0);
    assert.ok(lock.created_at);
  });

  it("lock file includes fixture files in hash", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(genDir, "vp.lock.json"), "utf-8"));
    const paths = lock.files.map(f => f.path);
    assert.ok(paths.some(p => p.includes("_fixtures")));
  });

  it("all generated specs have Playwright import", () => {
    const dir = path.join(genDir, "playwright");
    const specs = fs.readdirSync(dir).filter(f => f.endsWith(".spec.ts"));
    for (const spec of specs) {
      const content = fs.readFileSync(path.join(dir, spec), "utf-8");
      assert.ok(content.includes('import { test, expect } from "@playwright/test"'));
    }
  });

  it("login spec contains fill, url_matches, visible", () => {
    const dir = path.join(genDir, "playwright");
    const file = fs.readdirSync(dir).find(f => f.includes("login"));
    assert.ok(file, "login spec file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes(".fill("), "should contain fill");
    assert.ok(content.includes("toHaveURL("), "should contain url_matches");
    assert.ok(content.includes("toBeVisible()"), "should contain visible");
    assert.ok(content.includes("toHaveText("), "should contain text_equals");
    assert.ok(content.includes("ui-login: User can log in"), "should contain test title");
  });

  it("dashboard spec inlines setup fixture", () => {
    const dir = path.join(genDir, "playwright");
    const file = fs.readdirSync(dir).find(f => f.includes("dashboard"));
    assert.ok(file, "dashboard spec file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes("// setup: login-fixture"), "should reference fixture");
    assert.ok(content.includes(".fill("), "should inline fixture fill steps");
    assert.ok(content.includes("toHaveCount("), "should contain count assertion");
    assert.ok(content.includes("toBeHidden()"), "should contain hidden assertion");
  });

  it("nav spec contains hover and selectOption", () => {
    const dir = path.join(genDir, "playwright");
    const file = fs.readdirSync(dir).find(f => f.includes("nav"));
    assert.ok(file, "nav spec file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes(".hover()"), "should contain hover");
    assert.ok(content.includes(".selectOption("), "should contain selectOption");
    assert.ok(content.includes("toHaveText(new RegExp("), "should contain text_matches regex");
  });
});

describe("gen integration — error handling", () => {
  it("throws on invalid YAML check", async () => {
    const tmpDir = fs.mkdtempSync(path.join(fixturesDir, ".tmp-"));
    const vpDir = path.join(tmpDir, "vp", "ui");
    fs.mkdirSync(vpDir, { recursive: true });
    fs.writeFileSync(path.join(vpDir, "bad.yml"), "id: bad\ntitle: Bad\n");
    try {
      await assert.rejects(() => gen({ cwd: tmpDir }), /Validation failed in vp\/ui\/bad\.yml/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on unknown fixture reference", async () => {
    const tmpDir = fs.mkdtempSync(path.join(fixturesDir, ".tmp-"));
    const vpDir = path.join(tmpDir, "vp", "ui");
    fs.mkdirSync(vpDir, { recursive: true });
    const yml = [
      "id: ref-missing",
      "title: References missing fixture",
      "severity: blocker",
      "setup: nonexistent",
      "app:",
      "  kind: web",
      "  base_url: http://localhost:3000",
      "flow: []",
      "assert: []",
    ].join("\n");
    fs.writeFileSync(path.join(vpDir, "ref.yml"), yml);
    try {
      await assert.rejects(() => gen({ cwd: tmpDir }), /Unknown fixture "nonexistent"/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
