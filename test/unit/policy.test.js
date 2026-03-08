import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluatePolicy, findPolicies, opaAvailable } from "../../lib/policy.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-policy-"));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("policy helpers", () => {
  it("finds rego policies only", () => {
    withTmpDir(tmpDir => {
      const dir = path.join(tmpDir, "vp", "policy");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "guard.rego"), "package shipflow\n");
      fs.writeFileSync(path.join(dir, "notes.txt"), "ignore");
      const policies = findPolicies(tmpDir);
      assert.equal(policies.length, 1);
      assert.ok(policies[0].endsWith("guard.rego"));
    });
  });

  it("checks OPA availability through injected spawn", () => {
    assert.equal(opaAvailable(() => ({ status: 0 })), true);
    assert.equal(opaAvailable(() => ({ status: 1 })), false);
  });
});

describe("evaluatePolicy", () => {
  it("skips when no policies exist", () => {
    withTmpDir(tmpDir => {
      const result = evaluatePolicy({ cwd: tmpDir, lock: { vp_sha256: "x", files: [], created_at: "2026-03-08T00:00:00.000Z" } });
      assert.equal(result.ok, true);
      assert.equal(result.skipped, true);
      assert.deepEqual(result.results, []);
    });
  });

  it("throws when policies exist but OPA is unavailable", () => {
    withTmpDir(tmpDir => {
      const dir = path.join(tmpDir, "vp", "policy");
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen"), { recursive: true });
      fs.writeFileSync(path.join(dir, "guard.rego"), "package shipflow\n");
      assert.throws(() => evaluatePolicy({
        cwd: tmpDir,
        lock: { vp_sha256: "x", files: [], created_at: "2026-03-08T00:00:00.000Z" },
      }, {
        spawnSync: () => ({ status: 1, stdout: "", stderr: "" }),
      }), /OPA \(Open Policy Agent\) is required/);
    });
  });

  it("writes deny results when OPA reports a violation", () => {
    withTmpDir(tmpDir => {
      const dir = path.join(tmpDir, "vp", "policy");
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen"), { recursive: true });
      fs.writeFileSync(path.join(dir, "guard.rego"), "package shipflow\n");

      const spawnSync = (_bin, args) => {
        if (args[0] === "version") return { status: 0, stdout: "", stderr: "" };
        return {
          status: 0,
          stdout: JSON.stringify({
            result: [{
              expressions: [{
                value: ["vp/ui/admin.yml is forbidden"],
              }],
            }],
          }),
          stderr: "",
        };
      };

      const result = evaluatePolicy({
        cwd: tmpDir,
        lock: {
          vp_sha256: "abc123",
          files: [{ path: "vp/ui/admin.yml" }],
          created_at: "2026-03-08T00:00:00.000Z",
        },
      }, { spawnSync });

      assert.equal(result.ok, false);
      assert.equal(result.skipped, false);
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].ok, false);

      const evidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "policy.json"), "utf-8"));
      assert.equal(evidence.ok, false);
      assert.equal(evidence.results[0].denials[0], "vp/ui/admin.yml is forbidden");
    });
  });
});
