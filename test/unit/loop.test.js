import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { countVerificationPack, buildImplementationReport } from "../../lib/loop.js";

describe("countVerificationPack", () => {
  it("counts verifications by type", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-loop-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "api"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "vp", "security"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\n");
      fs.writeFileSync(path.join(tmpDir, "vp", "api", "users.yml"), "id: users\n");
      fs.writeFileSync(path.join(tmpDir, "vp", "security", "admin.yaml"), "id: admin\n");
      const counts = countVerificationPack(tmpDir);
      assert.equal(counts.ui, 1);
      assert.equal(counts.api, 1);
      assert.equal(counts.security, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("buildImplementationReport", () => {
  it("captures first-pass success and retry counts", () => {
    const report = buildImplementationReport({
      startedAt: Date.now() - 50,
      stage: "verify",
      ok: true,
      exitCode: 0,
      iterations: 1,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      vpCounts: { ui: 1 },
      generatedCounts: { ui: 1 },
      attempts: [{ iteration: 1, verify_exit_code: 0, ok: true }],
    });
    assert.equal(report.first_pass_success, true);
    assert.equal(report.retries_used, 0);
    assert.equal(report.provider, "anthropic");
  });
});
