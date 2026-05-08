import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  loadGovernance,
  writeDefaultGovernance,
  runGovernanceCheck,
  governanceCli,
  governanceFile,
} from "../../lib/governance.js";
import { createDecision, linkDecisionImpact } from "../../lib/decisions.js";
import { createGrillSession } from "../../lib/grill.js";
import { approvePack } from "../../lib/approvals.js";
import { createReview } from "../../lib/reviews.js";
import { withTmpDirAsync } from "../util/tmp.js";
import { captureStdio } from "../util/stdio.js";

const withTmpDir = (fn) => withTmpDirAsync("shipflow-governance", fn);

function writeGovernance(tmp, body) {
  fs.mkdirSync(path.dirname(governanceFile(tmp)), { recursive: true });
  fs.writeFileSync(governanceFile(tmp), body);
}

function seedVpHomeFile(tmp) {
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
  - text_equals:
      testid: heading
      equals: Welcome
`);
}

describe("governance", () => {
  it("init writes a default policy file when none exists", async () => {
    await withTmpDir(async (tmp) => {
      const { written, file } = writeDefaultGovernance(tmp);
      assert.equal(written, true);
      assert.ok(fs.existsSync(file));
      const second = writeDefaultGovernance(tmp);
      assert.equal(second.written, false);
    });
  });

  it("loadGovernance returns null policy when file missing", async () => {
    await withTmpDir(async (tmp) => {
      const { policy, present } = loadGovernance(tmp);
      assert.equal(policy, null);
      assert.equal(present, false);
    });
  });

  it("loadGovernance reports schema issues for invalid policy", async () => {
    await withTmpDir(async (tmp) => {
      fs.mkdirSync(path.dirname(governanceFile(tmp)), { recursive: true });
      writeGovernance(tmp, "version: 99\n");
      const { issues, policy } = loadGovernance(tmp);
      assert.equal(policy, null);
      assert.ok(issues.length >= 1);
    });
  });

  it("runGovernanceCheck warns when no policy is present", async () => {
    await withTmpDir(async (tmp) => {
      const result = runGovernanceCheck(tmp);
      const codes = result.findings.map(f => f.code);
      assert.ok(codes.includes("governance.no_policy"));
    });
  });

  it("require_pack_approval flags missing approval", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      writeDefaultGovernance(tmp);
      writeGovernance(tmp,
        "version: 1\nrequire_pack_approval: true\nrequired_approver_roles: []\nrequired_grill_roles: []\nmin_decisions_per_vp: 0\nrequire_negative_cases: false\nforbid_orphan_decisions: false\nforbid_open_reviews: false\n");
      const result = runGovernanceCheck(tmp);
      assert.equal(result.ok, false);
      assert.ok(result.findings.some(f => f.code === "governance.unapproved_pack"));
    });
  });

  it("required_approver_roles flags missing role even if pack is approved by another role", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      approvePack(tmp, { approver: "nic", role: "architect" });
      writeGovernance(tmp,
        "version: 1\nrequire_pack_approval: false\nrequired_approver_roles: [security]\nrequired_grill_roles: []\nmin_decisions_per_vp: 0\nrequire_negative_cases: false\nforbid_orphan_decisions: false\nforbid_open_reviews: false\n");
      const result = runGovernanceCheck(tmp);
      assert.equal(result.ok, false);
      assert.ok(result.findings.some(f => f.code === "governance.missing_approver_role"));
    });
  });

  it("required_grill_roles passes when matching session exists", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      await createGrillSession(tmp, { intent: "x", role: "security" });
      writeGovernance(tmp,
        "version: 1\nrequire_pack_approval: false\nrequired_approver_roles: []\nrequired_grill_roles: [security]\nmin_decisions_per_vp: 0\nrequire_negative_cases: false\nforbid_orphan_decisions: false\nforbid_open_reviews: false\n");
      const result = runGovernanceCheck(tmp);
      assert.ok(!result.findings.some(f => f.code === "governance.missing_grill_role"));
    });
  });

  it("min_decisions_per_vp flags vp files below threshold", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      writeGovernance(tmp,
        "version: 1\nrequire_pack_approval: false\nrequired_approver_roles: []\nrequired_grill_roles: []\nmin_decisions_per_vp: 1\nrequire_negative_cases: false\nforbid_orphan_decisions: false\nforbid_open_reviews: false\n");
      let result = runGovernanceCheck(tmp);
      assert.equal(result.ok, false);
      assert.ok(result.findings.some(f => f.code === "governance.under_decisioned"));

      createDecision(tmp, { id: "x", title: "T", question: "Q", decision: "D", rationale: "R" });
      linkDecisionImpact(tmp, "x", "vp/ui/home.yml");
      result = runGovernanceCheck(tmp);
      assert.equal(result.ok, true);
    });
  });

  it("forbid_open_reviews fails when an artifact review is open", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      writeGovernance(tmp,
        "version: 1\nrequire_pack_approval: false\nrequired_approver_roles: []\nrequired_grill_roles: []\nmin_decisions_per_vp: 0\nrequire_negative_cases: false\nforbid_orphan_decisions: false\nforbid_open_reviews: true\n");
      createReview(tmp, { target: "vp/ui/home.yml", target_kind: "vp", text: "Concern" });
      const result = runGovernanceCheck(tmp);
      assert.equal(result.ok, false);
      assert.ok(result.findings.some(f => f.code === "governance.open_reviews"));
    });
  });

  it("forbid_orphan_decisions fails when a decision has no impacts", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      writeGovernance(tmp,
        "version: 1\nrequire_pack_approval: false\nrequired_approver_roles: []\nrequired_grill_roles: []\nmin_decisions_per_vp: 0\nrequire_negative_cases: false\nforbid_orphan_decisions: true\nforbid_open_reviews: false\n");
      createDecision(tmp, { id: "lonely", title: "T", question: "Q", decision: "D", rationale: "R" });
      const result = runGovernanceCheck(tmp);
      assert.equal(result.ok, false);
      assert.ok(result.findings.some(f => f.code === "governance.orphan_decision"));
    });
  });

  it("runGovernanceCheck surfaces substrate load errors as findings", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      writeGovernance(tmp,
        "version: 1\nrequire_pack_approval: false\nrequired_approver_roles: []\nrequired_grill_roles: []\nmin_decisions_per_vp: 0\nrequire_negative_cases: false\nforbid_orphan_decisions: false\nforbid_open_reviews: false\n");
      // Drop a corrupt approval file that loadApprovals will reject
      const approvalsDir = path.join(tmp, ".shipflow", "approvals");
      fs.mkdirSync(approvalsDir, { recursive: true });
      fs.writeFileSync(path.join(approvalsDir, "broken.json"), "{not json");

      const result = runGovernanceCheck(tmp);
      assert.equal(result.ok, false,
        "governance must fail when a substrate file is unreadable — the policy check is unreliable otherwise");
      assert.ok(
        result.findings.some(f => f.code === "governance.substrate_load_error"),
        "must emit governance.substrate_load_error",
      );
      assert.ok(
        result.findings.some(f => /broken\.json/.test(f.message)),
        "the message must reference the corrupt file",
      );
    });
  });

  it("CLI: init writes the default file", async () => {
    await withTmpDir(async (tmp) => {
      const { result } = captureStdio(() => governanceCli({ cwd: tmp, args: ["init"] }));
      assert.equal(result.exitCode, 0);
      assert.ok(fs.existsSync(governanceFile(tmp)));
    });
  });

  it("CLI: check returns 0 when policy passes and 1 when it fails", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      // No policy → check warns but returns 0
      const r1 = captureStdio(() => governanceCli({ cwd: tmp, args: ["check"] }));
      assert.equal(r1.result.exitCode, 0);

      // Policy demanding approval → fails
      writeGovernance(tmp,
        "version: 1\nrequire_pack_approval: true\nrequired_approver_roles: []\nrequired_grill_roles: []\nmin_decisions_per_vp: 0\nrequire_negative_cases: false\nforbid_orphan_decisions: false\nforbid_open_reviews: false\n");
      const r2 = captureStdio(() => governanceCli({ cwd: tmp, args: ["check"] }));
      assert.equal(r2.result.exitCode, 1);
    });
  });
});
