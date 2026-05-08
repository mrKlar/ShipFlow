import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildReport, reportCli } from "../../lib/report.js";
import { createDecision, linkDecisionImpact } from "../../lib/decisions.js";
import { createGrillSession } from "../../lib/grill.js";
import { createSlice, linkSlice } from "../../lib/slices.js";
import { approvePack } from "../../lib/approvals.js";
import { createReview } from "../../lib/reviews.js";
import { withTmpDirAsync } from "../util/tmp.js";
import { captureStdio } from "../util/stdio.js";

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

describe("report", () => {
  it("buildReport returns sane defaults on an empty repo", async () => {
    await withTmpDirAsync("shipflow-report-empty", async (tmp) => {
      const r = buildReport(tmp);
      assert.equal(r.pack.verifications.total, 0);
      assert.equal(r.decisions.total, 0);
      assert.equal(r.grill.sessions, 0);
      assert.equal(r.slices.total, 0);
      assert.equal(r.approvals.total, 0);
      assert.equal(r.reviews.total, 0);
      assert.equal(r.evidence.last_run, null);
    });
  });

  it("buildReport aggregates a populated substrate with day calculations", async () => {
    await withTmpDirAsync("shipflow-report-full", async (tmp) => {
      seedVpHomeFile(tmp);
      const { session } = await createGrillSession(tmp, { intent: "X", role: "security" });
      createDecision(tmp, { id: "d1", title: "T", question: "Q", decision: "D", rationale: "R" });
      linkDecisionImpact(tmp, "d1", "vp/ui/home.yml");
      createSlice(tmp, { id: "s1", goal: "G" });
      linkSlice(tmp, "s1", { vp: ["vp/ui/home.yml"], decisions: ["d1"], grill_refs: [session.id] });

      // Approve 5 days ago
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      approvePack(tmp, { approver: "nic", role: "architect", approved_at: fiveDaysAgo.toISOString() });

      // Open review
      createReview(tmp, { target: "vp/ui/home.yml", target_kind: "vp", text: "Concern" });

      // Fake an evidence/run.json
      const evidenceDir = path.join(tmp, "evidence");
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, "run.json"), JSON.stringify({
        ok: true,
        started_at: new Date().toISOString(),
        passed: 1,
        failed: 0,
      }));

      const r = buildReport(tmp);
      assert.equal(r.pack.verifications.total, 1);
      assert.equal(r.decisions.total, 1);
      assert.equal(r.decisions.linked_to_vp, 1);
      assert.equal(r.grill.sessions, 1);
      assert.equal(r.grill.by_role.security, 1);
      assert.equal(r.slices.total, 1);
      assert.equal(r.slices.vp_present, 1);
      assert.equal(r.approvals.latest.approved_by, "nic");
      assert.equal(r.approvals.latest.matches_current_pack, true);
      assert.ok(r.approvals.latest.days_ago >= 4 && r.approvals.latest.days_ago <= 6,
        `days_ago should be ~5, got ${r.approvals.latest.days_ago}`);
      assert.equal(r.reviews.open, 1);
      assert.ok(r.reviews.oldest_open);
      assert.equal(r.evidence.last_run.ok, true);
    });
  });

  it("CLI: --json emits a parseable report", async () => {
    await withTmpDirAsync("shipflow-report-cli", async (tmp) => {
      const { result, stdout } = captureStdio(() => reportCli({ cwd: tmp, json: true }));
      assert.equal(result.exitCode, 0);
      const parsed = JSON.parse(stdout);
      assert.ok(parsed.generated_at);
      assert.ok(parsed.pack);
      assert.ok(parsed.substrate === undefined, "no fictional top-level keys");
      assert.ok(parsed.decisions);
    });
  });

  it("CLI: --markdown renders a header and a substrate table", async () => {
    await withTmpDirAsync("shipflow-report-md", async (tmp) => {
      seedVpHomeFile(tmp);
      const { result, stdout } = captureStdio(() => reportCli({ cwd: tmp, args: ["--markdown"] }));
      assert.equal(result.exitCode, 0);
      assert.match(stdout, /# ShipFlow report/);
      assert.match(stdout, /## Substrate/);
      assert.match(stdout, /\| Decisions \|/);
    });
  });
});
