import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { status } from "../../lib/status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("status", () => {
  function captureStatusOutput(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => {
      lines.push(args.join(" "));
    };
    try {
      fn();
    } finally {
      console.log = original;
    }
    return lines.join("\n");
  }

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

  it("shows draft session summary when present", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".shipflow"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".shipflow", "draft-session.json"), JSON.stringify({
      version: 1,
      updated_at: "2026-03-08T12:00:00.000Z",
      request: "todo app with login",
      review: {
        accepted: 1,
        rejected: 2,
        pending: 3,
        suggested_write: 2,
      },
      proposals: [],
    }));
    try {
      const output = captureStatusOutput(() => status({ cwd: tmpDir }));
      assert.match(output, /Draft session:/);
      assert.match(output, /todo app with login/);
      assert.match(output, /Accepted:\s+1/);
      assert.match(output, /Rejected:\s+2/);
      assert.match(output, /Pending:\s+3/);
      assert.match(output, /Suggested:\s+2/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
