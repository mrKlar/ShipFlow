import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLock, verifyLock, parseSummary } from "../../lib/verify.js";
import { sha256 } from "../../lib/util/hash.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("loadLock", () => {
  it("throws if .gen/vp.lock.json does not exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    try {
      assert.throws(() => loadLock(tmpDir), /Missing .gen\/vp.lock.json/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns parsed lock when file exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    const genDir = path.join(tmpDir, ".gen");
    fs.mkdirSync(genDir, { recursive: true });
    const lock = { version: 1, vp_sha256: "abc123", files: [] };
    fs.writeFileSync(path.join(genDir, "vp.lock.json"), JSON.stringify(lock));
    try {
      const result = loadLock(tmpDir);
      assert.equal(result.version, 1);
      assert.equal(result.vp_sha256, "abc123");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("verifyLock", () => {
  it("passes when VP matches lock", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    const vpDir = path.join(tmpDir, "vp", "ui");
    fs.mkdirSync(vpDir, { recursive: true });
    fs.writeFileSync(path.join(vpDir, "check.yml"), "id: test\n");

    const rel = path.relative(tmpDir, path.join(vpDir, "check.yml")).replaceAll("\\", "/");
    const buf = fs.readFileSync(path.join(vpDir, "check.yml"));
    const items = [{ path: rel, sha256: sha256(buf) }];
    const vpSha = sha256(Buffer.from(JSON.stringify(items)));
    const lock = { vp_sha256: vpSha };

    try {
      assert.doesNotThrow(() => verifyLock(tmpDir, lock));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when VP does not match lock", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    const vpDir = path.join(tmpDir, "vp", "ui");
    fs.mkdirSync(vpDir, { recursive: true });
    fs.writeFileSync(path.join(vpDir, "check.yml"), "id: test\n");

    const lock = { vp_sha256: "wrong-hash" };
    try {
      assert.throws(() => verifyLock(tmpDir, lock), /Verification pack changed/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("parseSummary", () => {
  it("extracts passed count", () => {
    const s = parseSummary("  10 passed (5s)\n");
    assert.equal(s.passed, 10);
  });

  it("extracts failed count", () => {
    const s = parseSummary("  3 failed\n  7 passed\n");
    assert.equal(s.failed, 3);
    assert.equal(s.passed, 7);
  });

  it("extracts skipped count", () => {
    const s = parseSummary("  2 skipped\n  5 passed\n");
    assert.equal(s.skipped, 2);
    assert.equal(s.passed, 5);
  });

  it("returns zeros for no matches", () => {
    const s = parseSummary("no useful output here");
    assert.equal(s.passed, 0);
    assert.equal(s.failed, 0);
    assert.equal(s.skipped, 0);
  });

  it("handles combined summary line", () => {
    const s = parseSummary("  5 passed, 2 failed, 1 skipped");
    assert.equal(s.passed, 5);
    assert.equal(s.failed, 2);
    assert.equal(s.skipped, 1);
  });
});
