import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  approvePack,
  loadApprovals,
  isPackApproved,
  isApprovalRequired,
  summarizeApprovalGate,
  revokeApproval,
  approvalsCli,
} from "../../lib/approvals.js";
import { computeVerificationPackSnapshot } from "../../lib/util/vp-snapshot.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-approvals-"));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function captureStdio(fn) {
  const out = [];
  const err = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const origLog = console.log;
  const origErrLog = console.error;
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  console.log = (...args) => { out.push(args.join(" ") + "\n"); };
  console.error = (...args) => { err.push(args.join(" ") + "\n"); };
  try {
    const result = fn();
    return { result, stdout: out.join(""), stderr: err.join("") };
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    console.log = origLog;
    console.error = origErrLog;
  }
}

function seedVerificationPack(tmp) {
  const dir = path.join(tmp, "vp", "ui");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "home.yml"), `
id: home
title: Home
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /
assert:
  - text_equals: { selector: "h1", text: "Welcome" }
`);
}

describe("approvals", () => {
  it("refuses to approve an empty pack", () => {
    withTmpDir(tmp => {
      assert.throws(() => approvePack(tmp), /empty verification pack/);
    });
  });

  it("approves a pack and reports it as approved", () => {
    withTmpDir(tmp => {
      seedVerificationPack(tmp);
      const { approval, file } = approvePack(tmp, { approver: "nic", role: "architect" });
      assert.ok(fs.existsSync(file));
      assert.equal(approval.approved_by, "nic");
      const status = isPackApproved(tmp);
      assert.equal(status.approved, true);
      assert.equal(status.pack_sha256, computeVerificationPackSnapshot(tmp).vp_sha256);
    });
  });

  it("invalidates approval when the pack changes", () => {
    withTmpDir(tmp => {
      seedVerificationPack(tmp);
      approvePack(tmp, { approver: "nic" });
      assert.equal(isPackApproved(tmp).approved, true);

      // Mutate the pack so the hash changes
      fs.appendFileSync(path.join(tmp, "vp", "ui", "home.yml"), "\n# tweak\n");
      const after = isPackApproved(tmp);
      assert.equal(after.approved, false);
      assert.ok(after.latest, "latest approval should still be reported");
    });
  });

  it("revoke marks an approval inactive", () => {
    withTmpDir(tmp => {
      seedVerificationPack(tmp);
      const { approval } = approvePack(tmp, { approver: "nic" });
      revokeApproval(tmp, approval.id, "Misclick");
      const status = isPackApproved(tmp);
      assert.equal(status.approved, false);
      const all = loadApprovals(tmp).items;
      assert.equal(all.length, 1);
      assert.ok(all[0].revoked_at);
      assert.equal(all[0].revoked_reason, "Misclick");
    });
  });

  it("isApprovalRequired honors env flag", () => {
    withTmpDir(tmp => {
      const env = { SHIPFLOW_REQUIRE_APPROVAL: "1" };
      assert.equal(isApprovalRequired(tmp, { env, readConfig: () => ({}) }), true);
      const env2 = { SHIPFLOW_REQUIRE_APPROVAL: "0" };
      assert.equal(isApprovalRequired(tmp, { env: env2, readConfig: () => ({}) }), false);
    });
  });

  it("isApprovalRequired honors shipflow.json config", () => {
    withTmpDir(tmp => {
      assert.equal(isApprovalRequired(tmp, { env: {}, readConfig: () => ({ impl: { requirePackApproval: true } }) }), true);
      assert.equal(isApprovalRequired(tmp, { env: {}, readConfig: () => ({}) }), false);
    });
  });

  it("summarizeApprovalGate blocks when required and not approved", () => {
    withTmpDir(tmp => {
      seedVerificationPack(tmp);
      const env = { SHIPFLOW_REQUIRE_APPROVAL: "1" };
      const gate = summarizeApprovalGate(tmp, { env, readConfig: () => ({}) });
      assert.equal(gate.required, true);
      assert.equal(gate.approved, false);
      assert.equal(gate.blocking_reasons.length, 1);
      assert.match(gate.blocking_reasons[0], /not approved/);

      approvePack(tmp, { approver: "nic" });
      const gate2 = summarizeApprovalGate(tmp, { env, readConfig: () => ({}) });
      assert.equal(gate2.approved, true);
      assert.equal(gate2.blocking_reasons.length, 0);
    });
  });

  it("summarizeApprovalGate is advisory when not required", () => {
    withTmpDir(tmp => {
      seedVerificationPack(tmp);
      const gate = summarizeApprovalGate(tmp, { env: {}, readConfig: () => ({}) });
      assert.equal(gate.required, false);
      assert.equal(gate.blocking_reasons.length, 0);
    });
  });

  it("CLI: approve-pack with no sub records an approval", () => {
    withTmpDir(tmp => {
      seedVerificationPack(tmp);
      const { result } = captureStdio(() => approvalsCli({
        cwd: tmp,
        args: ["--approver=nic", "--role=architect", "--scope=initial"],
      }));
      assert.equal(result.exitCode, 0);
      const items = loadApprovals(tmp).items;
      assert.equal(items.length, 1);
      assert.equal(items[0].approved_by, "nic");
      assert.equal(items[0].scope, "initial");
    });
  });

  it("CLI: approve-pack rejects an unknown role", () => {
    withTmpDir(tmp => {
      seedVerificationPack(tmp);
      const { result, stderr } = captureStdio(() => approvalsCli({
        cwd: tmp,
        args: ["--role=czar"],
      }));
      assert.equal(result.exitCode, 2);
      assert.match(stderr, /--role must be one of/);
    });
  });

  it("CLI: status shows approved/not approved transitions", () => {
    withTmpDir(tmp => {
      seedVerificationPack(tmp);
      const before = captureStdio(() => approvalsCli({ cwd: tmp, args: ["status"] }));
      assert.equal(before.result.exitCode, 0);
      assert.match(before.stdout, /NOT currently approved/);
      approvePack(tmp, { approver: "nic" });
      const after = captureStdio(() => approvalsCli({ cwd: tmp, args: ["status"] }));
      assert.match(after.stdout, /Approved by 1 active approval/);
    });
  });

  it("CLI: list emits json with __file paths relative to cwd", () => {
    withTmpDir(tmp => {
      seedVerificationPack(tmp);
      approvePack(tmp, { approver: "nic" });
      const { result, stdout } = captureStdio(() => approvalsCli({
        cwd: tmp,
        args: ["list"],
        json: true,
      }));
      assert.equal(result.exitCode, 0);
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.approvals.length, 1);
      assert.match(parsed.approvals[0].__file, /^\.shipflow\/approvals\//);
    });
  });
});
