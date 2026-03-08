import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { status } from "../../lib/status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("status", () => {
  it("runs without error on empty directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
    try {
      assert.doesNotThrow(() => status({ cwd: tmpDir }));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs without error with VP files", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    const vpDir = path.join(tmpDir, "vp", "ui");
    fs.mkdirSync(vpDir, { recursive: true });
    fs.writeFileSync(path.join(vpDir, "test.yml"), "id: test\n");
    try {
      assert.doesNotThrow(() => status({ cwd: tmpDir }));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs without error with evidence", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
    const evidDir = path.join(tmpDir, "evidence");
    fs.mkdirSync(evidDir, { recursive: true });
    fs.writeFileSync(path.join(evidDir, "run.json"), JSON.stringify({
      version: 1, ok: true, duration_ms: 1000,
      started_at: new Date().toISOString(), passed: 5, failed: 0,
    }));
    try {
      assert.doesNotThrow(() => status({ cwd: tmpDir }));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs without error with implement history evidence", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
    const evidDir = path.join(tmpDir, "evidence");
    fs.mkdirSync(evidDir, { recursive: true });
    fs.writeFileSync(path.join(evidDir, "implement-history.json"), JSON.stringify({
      version: 1,
      updated_at: new Date().toISOString(),
      summary: {
        total_runs: 3,
        pass_rate: 0.667,
        first_pass_rate: 0.333,
        average_iterations: 1.67,
      },
      runs: [],
    }));
    try {
      assert.doesNotThrow(() => status({ cwd: tmpDir }));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
