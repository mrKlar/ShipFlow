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

  it("generates a Playwright runtime config under .gen", () => {
    const configPath = path.join(genDir, "playwright.config.mjs");
    assert.ok(fs.existsSync(configPath));
    const content = fs.readFileSync(configPath, "utf-8");
    assert.ok(content.includes('import { defineConfig } from "@playwright/test"'));
    assert.ok(content.includes('const webServerCommand = process.env.SHIPFLOW_WEB_SERVER_COMMAND || "npm run dev";'));
    assert.ok(content.includes('const hasExternalWebServer = process.env.SHIPFLOW_EXTERNAL_WEB_SERVER === "1";'));
    assert.ok(content.includes('const workers = Number(process.env.SHIPFLOW_PLAYWRIGHT_WORKERS || "1");'));
    assert.ok(content.includes("workers: Number.isFinite(workers) && workers > 0 ? workers : 1,"));
    assert.ok(content.includes('url: baseURL'));
    assert.ok(!content.includes("port:"), "should not mix url and port in webServer config");
  });

  it("generates one test per Playwright-backed check YAML", () => {
    const tests = fs.readdirSync(path.join(genDir, "playwright")).filter(f => f.endsWith(".test.ts"));
    // 3 UI + 1 behavior + 1 API + 1 DB + 1 security = 7
    assert.equal(tests.length, 7);
  });

  it("generates vp.lock.json with correct structure", () => {
    const lockPath = path.join(genDir, "vp.lock.json");
    assert.ok(fs.existsSync(lockPath));
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    assert.equal(lock.version, 2);
    assert.ok(typeof lock.vp_sha256 === "string");
    assert.ok(lock.vp_sha256.length === 64);
    assert.ok(Array.isArray(lock.files));
    assert.ok(lock.files.length > 0);
    assert.ok(typeof lock.generated_sha256 === "string");
    assert.ok(lock.generated_sha256.length === 64);
    assert.ok(Array.isArray(lock.generated_files));
    assert.ok(lock.generated_files.length > 0);
    assert.ok(lock.created_at);
  });

  it("lock file includes fixture files in hash", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(genDir, "vp.lock.json"), "utf-8"));
    const paths = lock.files.map(f => f.path);
    assert.ok(paths.some(p => p.includes("_fixtures")));
  });

  it("lock file includes generated artifacts in hash", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(genDir, "vp.lock.json"), "utf-8"));
    const paths = lock.generated_files.map(file => file.path);
    assert.ok(paths.includes(".gen/manifest.json"));
    assert.ok(paths.some(file => file.startsWith(".gen/playwright/")));
  });

  it("all generated tests have Playwright import", () => {
    const dir = path.join(genDir, "playwright");
    const tests = fs.readdirSync(dir).filter(f => f.endsWith(".test.ts"));
    for (const t of tests) {
      const content = fs.readFileSync(path.join(dir, t), "utf-8");
      assert.ok(content.includes('import { test, expect } from "@playwright/test"'));
    }
  });

  it("login test contains fill, url_matches, visible", () => {
    const dir = path.join(genDir, "playwright");
    const file = fs.readdirSync(dir).find(f => f.includes("login"));
    assert.ok(file, "login test file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes(".fill("), "should contain fill");
    assert.ok(content.includes("toHaveURL("), "should contain url_matches");
    assert.ok(content.includes("toBeVisible()"), "should contain visible");
    assert.ok(content.includes("toHaveText("), "should contain text_equals");
    assert.ok(content.includes("ui-login: User can log in"), "should contain test title");
  });

  it("dashboard test inlines setup fixture", () => {
    const dir = path.join(genDir, "playwright");
    const file = fs.readdirSync(dir).find(f => f.includes("dashboard"));
    assert.ok(file, "dashboard test file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes("// setup: login-fixture"), "should reference fixture");
    assert.ok(content.includes(".fill("), "should inline fixture fill steps");
    assert.ok(content.includes("toHaveCount("), "should contain count assertion");
    assert.ok(content.includes("toBeHidden()"), "should contain hidden assertion");
  });

  it("nav test contains hover and selectOption", () => {
    const dir = path.join(genDir, "playwright");
    const file = fs.readdirSync(dir).find(f => f.includes("nav"));
    assert.ok(file, "nav test file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes(".hover()"), "should contain hover");
    assert.ok(content.includes(".selectOption("), "should contain selectOption");
    assert.ok(content.includes("toHaveText(new RegExp("), "should contain text_matches regex");
  });

  it("behavior test has test.describe and Given/When/Then", () => {
    const dir = path.join(genDir, "playwright");
    const file = fs.readdirSync(dir).find(f => f.includes("behavior"));
    assert.ok(file, "behavior test file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes("test.describe("), "should use test.describe");
    assert.ok(content.includes("// Given"), "should have Given comment");
    assert.ok(content.includes("// When"), "should have When comment");
    assert.ok(content.includes("// Then"), "should have Then comment");
    assert.ok(content.includes("// setup: login-fixture"), "should inline fixture");
  });

  it("API test uses request fixture", () => {
    const dir = path.join(genDir, "playwright");
    const file = fs.readdirSync(dir).find(f => f.includes("api"));
    assert.ok(file, "API test file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes("{ request }"), "should use request fixture");
    assert.ok(content.includes("sendShipFlowRequest"), "should use request helper");
    assert.ok(content.includes("REQUEST_SPEC"), "should embed original request spec");
    assert.ok(content.includes("MUTATION_REQUEST_SPEC"), "should embed mutated request spec");
    assert.ok(content.includes("res.status()"), "should check status");
    assert.ok(content.includes("JSON.parse(rawBody)"), "should parse JSON body");
    assert.ok(content.includes("Bearer test-token"), "should include auth header");
  });

  it("DB test uses execFileSync and sqlite3", () => {
    const dir = path.join(genDir, "playwright");
    const file = fs.readdirSync(dir).find(f => f.includes("db"));
    assert.ok(file, "DB test file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes("execFileSync"), "should import execFileSync");
    assert.ok(content.includes("sqlite3"), "should use sqlite3 CLI");
    assert.ok(content.includes("function query(sql)"), "should define query helper");
    assert.ok(content.includes("exec("), "should call exec for setup_sql");
    assert.ok(content.includes("toHaveLength(1)"), "should check row_count");
  });

  it("security test uses request fixture and security assertions", () => {
    const dir = path.join(genDir, "playwright");
    const file = fs.readdirSync(dir).find(f => f.includes("security"));
    assert.ok(file, "security test file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes('{ request }'), "should use request fixture");
    assert.ok(content.includes("Security: authz"), "should group security tests");
    assert.ok(content.includes("sendShipFlowSecurityRequest"), "should issue requests through the helper");
    assert.ok(content.includes("MUTATION_REQUEST_SPEC"), "should include the mutated request spec");
    assert.ok(content.includes("toBe(401)"), "should assert rejection");
    assert.ok(content.includes("toBe(false)"), "should assert missing header");
  });

  it("technical runner inspects repository constraints", () => {
    const dir = path.join(genDir, "technical");
    const file = fs.readdirSync(dir).find(f => f.includes("technical") && f.endsWith(".runner.mjs"));
    assert.ok(file, "technical runner file should exist");
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.ok(content.includes("ShipFlow technical backend"), "should declare the technical backend");
    assert.ok(content.includes('import fs from "node:fs"'), "should inspect repository files");
    assert.ok(content.includes('actions/checkout@v4'), "should assert workflow actions");
    assert.ok(content.includes("runGenericAssertions"), "should contain repo-level helper execution");
  });

  it("generates k6 script for NFR check", () => {
    const k6Dir = path.join(genDir, "k6");
    assert.ok(fs.existsSync(k6Dir), ".gen/k6/ should exist");
    const scripts = fs.readdirSync(k6Dir).filter(f => f.endsWith(".js"));
    assert.equal(scripts.length, 1, "should have 1 k6 script");
    const content = fs.readFileSync(path.join(k6Dir, scripts[0]), "utf-8");
    assert.ok(content.includes('import http from "k6/http"'), "should import k6");
    assert.ok(content.includes("vus: 50"), "should have vus");
    assert.ok(content.includes("p(95)<500"), "should have threshold");
    assert.ok(content.includes("http.get("), "should have GET request");
  });

  it("prunes stale generated artifacts", async () => {
    const stalePw = path.join(genDir, "playwright", "stale.test.ts");
    const staleK6 = path.join(genDir, "k6", "stale.js");
    fs.writeFileSync(stalePw, "// stale");
    fs.writeFileSync(staleK6, "// stale");

    await gen({ cwd: fixturesDir });

    assert.equal(fs.existsSync(stalePw), false);
    assert.equal(fs.existsSync(staleK6), false);
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
