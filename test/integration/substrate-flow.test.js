// End-to-end integration test for the understanding-to-verification flow.
// Exercises grill -> decision -> slice -> approve -> critique -> trace ->
// governance against a fresh tmp directory, asserting state and exit codes
// at each step. This complements the unit tests by catching cross-module
// regressions (e.g. a change to the Slice schema that breaks how the trace
// matrix joins decisions to vp files).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createGrillSession, findGrillSession } from "../../lib/grill.js";
import { grillCli } from "../../lib/grill.js";
import { findDecision, loadDecisions } from "../../lib/decisions.js";
import { createSlice, findSlice, linkSlice } from "../../lib/slices.js";
import {
  approvePack,
  isPackApproved,
  isApprovalRequired,
  summarizeApprovalGate,
} from "../../lib/approvals.js";
import { runCritique } from "../../lib/critique.js";
import { buildTrace } from "../../lib/trace.js";
import {
  loadGovernance,
  writeDefaultGovernance,
  runGovernanceCheck,
  governanceFile,
} from "../../lib/governance.js";
import { collectStatus } from "../../lib/status.js";
import { withTmpDirAsync } from "../util/tmp.js";
import { captureStdio } from "../util/stdio.js";

const VP_HOME = `
id: home
title: Home page renders the welcome heading
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
`;

const VP_LOGIN_ERROR = `
id: login-error
title: Login shows an error on invalid credentials
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /login
assert:
  - text_equals:
      testid: login-error
      equals: Invalid credentials
`;

function seedVerificationPack(tmp) {
  const dir = path.join(tmp, "vp", "ui");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "home.yml"), VP_HOME);
  fs.writeFileSync(path.join(dir, "login-error.yml"), VP_LOGIN_ERROR);
}

function writeGovernancePolicy(tmp, body) {
  fs.mkdirSync(path.dirname(governanceFile(tmp)), { recursive: true });
  fs.writeFileSync(governanceFile(tmp), body);
}

describe("substrate flow integration — understanding-to-verification end-to-end", () => {
  it("walks grill → decision → slice → approve → critique → trace → governance", async () => {
    await withTmpDirAsync("shipflow-substrate-flow", async (tmp) => {
      // ── 1. Seed a small verification pack ────────────────────────────
      seedVerificationPack(tmp);
      const status0 = collectStatus(tmp);
      assert.equal(status0.verifications.total, 2, "two vp files seeded");
      assert.equal(status0.decisions.total, 0, "no decisions yet");
      assert.equal(status0.grill.sessions, 0, "no grill sessions yet");
      assert.equal(status0.slices.total, 0, "no slices yet");
      assert.equal(status0.approval.required, false, "approval gating off by default");
      assert.equal(status0.approval.approved, false, "no active approval yet");

      // ── 2. Run a grill session (offline template) ────────────────────
      const grillResult = await createGrillSession(tmp, {
        intent: "Make sure the home page welcomes users and login surfaces errors clearly",
        role: "qa",
      });
      assert.ok(fs.existsSync(grillResult.jsonFile));
      assert.ok(fs.existsSync(grillResult.mdFile));
      assert.equal(grillResult.session.role, "qa");
      assert.ok(grillResult.session.questions.length >= 3, "qa template has at least 3 questions");
      const sessionId = grillResult.session.id;
      assert.ok(findGrillSession(tmp, sessionId), "grill session is loadable by id");

      // ── 3. Promote a manually crafted proposed decision via the CLI ──
      // The offline grill template has no proposed_decisions; the AI
      // mode would. Inject one by mutating the JSON file (mimics what
      // the AI would have produced) so we can test the promote path.
      const sessionRaw = JSON.parse(fs.readFileSync(grillResult.jsonFile, "utf-8"));
      sessionRaw.proposed_decisions = [{
        id: "welcome-copy",
        type: "product",
        title: "Welcome heading copy",
        question: "What should the home page heading say?",
        decision: "Use 'Welcome' to keep onboarding minimal.",
        rationale: "Matches existing brand guidelines and keeps the page honest.",
        impacts: ["vp/ui/home.yml"],
      }];
      fs.writeFileSync(grillResult.jsonFile, JSON.stringify(sessionRaw, null, 2) + "\n");

      const promote = await captureStdio(() => grillCli({
        cwd: tmp,
        args: ["promote", sessionId, "--decision=welcome-copy"],
      }));
      assert.equal(promote.result.exitCode, 0, "promote exits 0");
      const promoted = findDecision(tmp, "welcome-copy");
      assert.ok(promoted, "decision was created in .shipflow/decisions/");
      assert.equal(promoted.source, "grill", "decision tracks its grill origin");
      assert.equal(promoted.source_ref, sessionId, "decision references the grill session id");
      assert.deepEqual(promoted.impacts, ["vp/ui/home.yml"], "decision impacts the home vp file");

      // ── 4. Build a slice that ties it all together ───────────────────
      createSlice(tmp, {
        id: "first-impression",
        goal: "User opens the app, sees a welcome, and sees an error if login fails.",
        status: "planned",
      });
      linkSlice(tmp, "first-impression", {
        vp: ["vp/ui/home.yml", "vp/ui/login-error.yml"],
        decisions: ["welcome-copy"],
        grill_refs: [sessionId],
      });
      const slice = findSlice(tmp, "first-impression");
      assert.deepEqual(slice.vp.sort(), ["vp/ui/home.yml", "vp/ui/login-error.yml"]);
      assert.deepEqual(slice.decisions, ["welcome-copy"]);
      assert.deepEqual(slice.grill_refs, [sessionId]);

      // ── 5. Critique the pack ─────────────────────────────────────────
      const critique = runCritique(tmp);
      // We expect:
      //  - no critique.happy_path_only (login-error is a negative case)
      //  - no critique.no_decision_link for vp/ui/home.yml (we linked it)
      //  - critique.no_decision_link for vp/ui/login-error.yml (not yet linked)
      const codes = critique.findings.map(f => f.code);
      assert.equal(codes.includes("critique.happy_path_only"), false,
        "negative case (login-error) suppresses the happy_path_only flag");
      assert.equal(critique.summary.checks, 2);
      assert.equal(critique.summary.negative_checks, 1, "login-error counts as a negative-case check");
      assert.equal(critique.summary.decisions_total, 1);
      assert.equal(critique.summary.decision_linked_files, 1, "only home.yml has a decision impact bound");
      assert.ok(codes.includes("critique.no_decision_link"), "login-error.yml is flagged as unlinked");

      // ── 6. Approval gate: off by default, on under env flag ──────────
      const gateOff = summarizeApprovalGate(tmp, { env: {}, readConfig: () => ({}) });
      assert.equal(gateOff.required, false);
      assert.equal(gateOff.approved, false);
      assert.equal(gateOff.blocking_reasons.length, 0, "advisory mode emits no blockers");

      const gateRequired = summarizeApprovalGate(tmp, {
        env: { SHIPFLOW_REQUIRE_APPROVAL: "1" },
        readConfig: () => ({}),
      });
      assert.equal(gateRequired.required, true);
      assert.equal(gateRequired.approved, false);
      assert.equal(gateRequired.blocking_reasons.length, 1);
      assert.match(gateRequired.blocking_reasons[0], /not approved/);

      // Sign the pack
      const { approval } = approvePack(tmp, {
        approver: "nic",
        role: "architect",
        decision_refs: ["welcome-copy"],
        grill_refs: [sessionId],
      });
      const after = isPackApproved(tmp);
      assert.equal(after.approved, true, "pack now matches an active approval");
      assert.equal(approval.role, "architect");
      assert.deepEqual(approval.decision_refs, ["welcome-copy"]);
      assert.deepEqual(approval.grill_refs, [sessionId]);

      // ── 7. Mutating the pack invalidates the approval ────────────────
      fs.appendFileSync(path.join(tmp, "vp", "ui", "home.yml"), "\n# tweak\n");
      const afterMutation = isPackApproved(tmp);
      assert.equal(afterMutation.approved, false,
        "any vp change invalidates every active approval");
      assert.ok(afterMutation.latest, "the prior approval is still listed for audit");

      // Re-approve to bring the pack back to a clean state for the rest
      // of the flow.
      approvePack(tmp, { approver: "nic", role: "architect" });
      assert.equal(isPackApproved(tmp).approved, true);

      // ── 8. Trace: the matrix should join everything correctly ────────
      const trace = buildTrace(tmp);
      assert.match(trace.pack_sha256, /^[a-f0-9]{64}$/i);
      assert.equal(trace.approval.length, 1, "one active approval matches current pack");
      assert.equal(trace.rows.length, 2, "one row per vp file");

      const homeRow = trace.rows.find(r => r.vp === "vp/ui/home.yml");
      assert.ok(homeRow);
      assert.equal(homeRow.decisions.length, 1, "home is linked to welcome-copy");
      assert.equal(homeRow.decisions[0].id, "welcome-copy");
      assert.equal(homeRow.slices.length, 1);
      assert.equal(homeRow.slices[0].id, "first-impression");
      assert.equal(homeRow.grill_sessions.length, 1);
      assert.equal(homeRow.grill_sessions[0].id, sessionId);

      const errorRow = trace.rows.find(r => r.vp === "vp/ui/login-error.yml");
      assert.ok(errorRow);
      assert.equal(errorRow.decisions.length, 0, "login-error has no decision yet");
      assert.equal(errorRow.slices.length, 1, "but it IS in the slice");

      assert.equal(trace.orphans.decisions.length, 0, "no orphan decisions");
      assert.equal(trace.orphans.slices.length, 0, "no orphan slices");

      // ── 9. Governance: pass when policy is permissive ────────────────
      writeGovernancePolicy(tmp,
        "version: 1\n" +
        "require_pack_approval: true\n" +
        "required_approver_roles: [architect]\n" +
        "required_grill_roles: []\n" +
        "min_decisions_per_vp: 0\n" +
        "require_negative_cases: true\n" +
        "forbid_orphan_decisions: false\n" +
        "forbid_open_reviews: false\n");
      const gov1 = runGovernanceCheck(tmp);
      assert.equal(gov1.ok, true, "governance passes: approved + has negative case + has architect role");
      assert.equal(gov1.summary.errors, 0);

      // ── 10. Governance: tighten policy to demand decision linkage ────
      writeGovernancePolicy(tmp,
        "version: 1\n" +
        "require_pack_approval: true\n" +
        "required_approver_roles: [architect]\n" +
        "required_grill_roles: []\n" +
        "min_decisions_per_vp: 1\n" +
        "require_negative_cases: true\n" +
        "forbid_orphan_decisions: false\n" +
        "forbid_open_reviews: false\n");
      const gov2 = runGovernanceCheck(tmp);
      assert.equal(gov2.ok, false,
        "governance fails: login-error.yml has 0 decisions bound, threshold is 1");
      assert.ok(gov2.findings.some(f => f.code === "governance.under_decisioned"));

      // ── 11. Final status surfaces every collected piece ──────────────
      const finalStatus = collectStatus(tmp);
      assert.equal(finalStatus.verifications.total, 2);
      assert.equal(finalStatus.decisions.total, 1);
      assert.equal(finalStatus.decisions.linked_to_vp, 1);
      assert.equal(finalStatus.grill.sessions, 1);
      assert.equal(finalStatus.slices.total, 1);
      assert.equal(finalStatus.approval.matching_approvals, 1, "current pack has one matching active approval");
    });
  });

  it("rejects implementation when approval gate is on but pack changed", async () => {
    await withTmpDirAsync("shipflow-substrate-gate", async (tmp) => {
      seedVerificationPack(tmp);

      // Required approval, sign once, then mutate the pack — the gate
      // must surface a blocking reason.
      const env = { SHIPFLOW_REQUIRE_APPROVAL: "1" };
      approvePack(tmp, { approver: "nic", role: "architect" });
      assert.equal(summarizeApprovalGate(tmp, { env, readConfig: () => ({}) }).blocking_reasons.length, 0);

      fs.appendFileSync(path.join(tmp, "vp", "ui", "home.yml"), "\n# unreviewed change\n");
      const gate = summarizeApprovalGate(tmp, { env, readConfig: () => ({}) });
      assert.equal(gate.required, true);
      assert.equal(gate.approved, false);
      assert.equal(gate.blocking_reasons.length, 1);
      assert.match(gate.blocking_reasons[0], /pack has changed/i);
    });
  });
});
