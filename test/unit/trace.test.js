import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTrace, traceCli, matchEvidenceForVp } from "../../lib/trace.js";
import { createDecision, linkDecisionImpact } from "../../lib/decisions.js";
import { createGrillSession } from "../../lib/grill.js";
import { createSlice, linkSlice } from "../../lib/slices.js";
import { approvePack } from "../../lib/approvals.js";
import { createReview } from "../../lib/reviews.js";
import { withTmpDirAsync } from "../util/tmp.js";
import { captureStdio } from "../util/stdio.js";

const withTmpDir = (fn) => withTmpDirAsync("shipflow-trace", fn);

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

describe("trace.matchEvidenceForVp — substring false-positive guard", () => {
  it("does NOT match an evidence path that merely contains the vp basename as a substring", () => {
    // The legacy bug: `evidence/reauth.json` would have matched `vp/api/auth.yml`
    // because String.includes("auth") was the join. The current implementation
    // requires either an exact basename match or a full directory segment.
    const matches = matchEvidenceForVp("vp/api/auth.yml", [
      "evidence/reauth.json",
      "evidence/auth-something-else.json",
      "evidence/api/something.json",
    ]);
    assert.deepEqual(matches, [],
      "neither reauth nor auth-something-else nor api/something belong to vp/api/auth.yml");
  });

  it("matches an evidence file whose basename equals the vp basename", () => {
    const matches = matchEvidenceForVp("vp/api/auth.yml", ["evidence/auth.json"]);
    assert.deepEqual(matches, ["evidence/auth.json"]);
  });

  it("matches a directory-segregated evidence file (evidence/<vp-base>/...)", () => {
    const matches = matchEvidenceForVp("vp/ui/home.yml", [
      "evidence/visual/home/expected.png",
      "evidence/visual/home/diff.png",
    ]);
    assert.equal(matches.length, 2);
  });

  it("matches /<base>.<ext> at the end of any path segment", () => {
    const matches = matchEvidenceForVp("vp/api/users.yml", [
      "evidence/api/users.json",
      "evidence/api/users.log",
    ]);
    assert.equal(matches.length, 2);
  });
});

describe("trace", () => {
  it("buildTrace builds a row per vp file with empty linkages by default", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      const trace = buildTrace(tmp);
      assert.equal(trace.rows.length, 1);
      assert.equal(trace.rows[0].vp, "vp/ui/home.yml");
      assert.equal(trace.rows[0].decision_count, 0);
      assert.equal(trace.rows[0].slice_count, 0);
    });
  });

  it("buildTrace links decisions, slices, grill, approvals, and reviews", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      const { session } = await createGrillSession(tmp, { intent: "Welcome page", role: "general" });
      createDecision(tmp, {
        id: "welcome-copy",
        title: "Welcome copy",
        question: "Q",
        decision: "D",
        rationale: "R",
        source: "grill",
        source_ref: session.id,
      });
      linkDecisionImpact(tmp, "welcome-copy", "vp/ui/home.yml");

      createSlice(tmp, { id: "first-slice", goal: "Show home page" });
      linkSlice(tmp, "first-slice", { vp: ["vp/ui/home.yml"], decisions: ["welcome-copy"], grill_refs: [session.id] });

      approvePack(tmp, { approver: "nic", role: "architect" });

      createReview(tmp, { target: "vp/ui/home.yml", target_kind: "vp", text: "Copy needs review" });

      const trace = buildTrace(tmp);
      assert.equal(trace.rows.length, 1);
      const row = trace.rows[0];
      assert.equal(row.decisions.length, 1);
      assert.equal(row.decisions[0].id, "welcome-copy");
      assert.equal(row.slices.length, 1);
      assert.equal(row.slices[0].id, "first-slice");
      assert.equal(row.grill_sessions.length, 1);
      assert.equal(row.open_review_count, 1);
      assert.equal(trace.approval.length, 1);
      assert.equal(trace.approval[0].approved_by, "nic");
    });
  });

  it("buildTrace surfaces orphans (decisions/slices/reviews not bound to any existing vp file)", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      createDecision(tmp, {
        id: "lonely",
        title: "Lonely",
        question: "Q",
        decision: "D",
        rationale: "R",
      });
      createSlice(tmp, { id: "ghost", goal: "G", vp: ["vp/security/missing.yml"] });
      createReview(tmp, { target: "vp/api/missing.yml", target_kind: "vp", text: "T" });
      const trace = buildTrace(tmp);
      assert.equal(trace.orphans.decisions.length, 1);
      assert.equal(trace.orphans.slices.length, 1);
      assert.equal(trace.orphans.reviews.length, 1);
    });
  });

  it("CLI: trace JSON includes pack_sha256 and rows", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      const { result, stdout } = captureStdio(() => traceCli({ cwd: tmp, args: [], json: true }));
      assert.equal(result.exitCode, 0);
      const parsed = JSON.parse(stdout);
      assert.match(parsed.pack_sha256, /^[a-f0-9]{64}$/i);
      assert.equal(parsed.rows.length, 1);
    });
  });

  it("CLI: --pr-comment emits an approval icon, action list, and per-vp table", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      const { result, stdout } = captureStdio(() => traceCli({ cwd: tmp, args: ["--pr-comment"] }));
      assert.equal(result.exitCode, 0);
      // No approval yet -> warning icon and the approve-pack action item
      assert.match(stdout, /⚠️ ShipFlow trace/);
      assert.match(stdout, /not approved against the current sha/);
      assert.match(stdout, /Run `shipflow approve-pack`/);
      // Detail table is collapsible and includes the seeded vp file
      assert.match(stdout, /VP coverage detail/);
      assert.match(stdout, /vp\/ui\/home\.yml/);
    });
  });

  it("CLI: --pr-comment surfaces 'no outstanding actions' on a clean pack", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      // Bind a decision and approve so the comment has no action items
      const { createDecision: createDec, linkDecisionImpact: linkImp } = await import("../../lib/decisions.js");
      const { approvePack: approve } = await import("../../lib/approvals.js");
      createDec(tmp, { id: "welcome", title: "T", question: "Q", decision: "D", rationale: "R" });
      linkImp(tmp, "welcome", "vp/ui/home.yml");
      approve(tmp, { approver: "nic", role: "architect" });

      const { stdout } = captureStdio(() => traceCli({ cwd: tmp, args: ["--pr-comment"] }));
      assert.match(stdout, /✅ ShipFlow trace/);
      assert.match(stdout, /No outstanding actions before merge/);
    });
  });

  it("buildTrace surfaces loader issues for corrupt substrate files", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      // Corrupt decision file
      const decisionsDir = path.join(tmp, ".shipflow", "decisions");
      fs.mkdirSync(decisionsDir, { recursive: true });
      fs.writeFileSync(path.join(decisionsDir, "0001-broken.yml"), "id: bad\n  : not yaml");
      const t = buildTrace(tmp);
      assert.ok(Array.isArray(t.loader_issues));
      assert.ok(t.loader_issues.length > 0);
      const decisionIssues = t.loader_issues.filter(i => i.surface === "decisions");
      assert.ok(decisionIssues.length >= 1, "decision parse error must propagate to trace");
    });
  });

  it("CLI: --pr-comment surfaces loader issues as a top action item", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      const decisionsDir = path.join(tmp, ".shipflow", "decisions");
      fs.mkdirSync(decisionsDir, { recursive: true });
      fs.writeFileSync(path.join(decisionsDir, "broken.yml"), "id: bad\n  - oops");
      const { stdout } = captureStdio(() => traceCli({ cwd: tmp, args: ["--pr-comment"] }));
      assert.match(stdout, /Substrate file unreadable/);
    });
  });

  it("CLI: --markdown emits a header and table", async () => {
    await withTmpDir(async (tmp) => {
      seedVpHomeFile(tmp);
      const { result, stdout } = captureStdio(() => traceCli({ cwd: tmp, args: ["--markdown"] }));
      assert.equal(result.exitCode, 0);
      assert.match(stdout, /# ShipFlow Traceability/);
      assert.match(stdout, /\| VP file \|/);
    });
  });
});
