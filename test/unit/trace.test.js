import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildTrace, traceCli } from "../../lib/trace.js";
import { createDecision, linkDecisionImpact } from "../../lib/decisions.js";
import { createGrillSession } from "../../lib/grill.js";
import { createSlice, linkSlice } from "../../lib/slices.js";
import { approvePack } from "../../lib/approvals.js";
import { createReview } from "../../lib/reviews.js";

async function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-trace-"));
  try {
    return await fn(tmpDir);
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
