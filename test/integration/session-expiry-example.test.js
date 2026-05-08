// The session-expiry-substrate example is the "after" snapshot of the
// User Guide walkthrough. This test makes sure the committed substrate
// (vp + decision + grill + slice) stays internally consistent so the
// example does not bit-rot under future schema changes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildTrace } from "../../lib/trace.js";
import { runCritique } from "../../lib/critique.js";
import { collectStatus } from "../../lib/status.js";
import { loadDecisions } from "../../lib/decisions.js";
import { loadSlices } from "../../lib/slices.js";
import { loadGrillSessions } from "../../lib/grill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(__dirname, "..", "..", "examples", "session-expiry-substrate");

describe("examples/session-expiry-substrate stays valid", () => {
  it("status surfaces 2 vp + 1 decision + 1 grill session + 1 slice", () => {
    const s = collectStatus(exampleDir);
    assert.equal(s.verifications.total, 2);
    assert.equal(s.decisions.total, 1);
    assert.equal(s.decisions.linked_to_vp, 1, "the committed decision impacts both vp files");
    assert.equal(s.grill.sessions, 1);
    assert.equal(s.slices.total, 1);
  });

  it("decisions, slices, and grill sessions load without parse errors", () => {
    assert.equal(loadDecisions(exampleDir).issues.length, 0);
    assert.equal(loadSlices(exampleDir).issues.length, 0,
      "slice must reference a real decision and a real grill session");
    assert.equal(loadGrillSessions(exampleDir).issues.length, 0);
  });

  it("critique scores >= 85 (strong) with no errors", () => {
    const r = runCritique(exampleDir);
    assert.equal(r.summary.errors, 0);
    assert.ok(r.summary.score >= 85, `expected score >= 85, got ${r.summary.score}`);
  });

  it("trace joins every vp file to a decision, a slice, and a grill session", () => {
    const t = buildTrace(exampleDir);
    assert.equal(t.rows.length, 2);
    for (const row of t.rows) {
      assert.equal(row.decisions.length, 1, `${row.vp} must have one decision linked`);
      assert.equal(row.slices.length, 1, `${row.vp} must be grouped into a slice`);
      assert.equal(row.grill_sessions.length, 1,
        `${row.vp} must trace back to a grill session via the linked decision`);
    }
    assert.equal(t.orphans.decisions.length, 0);
    assert.equal(t.orphans.slices.length, 0);
    assert.equal(t.orphans.reviews.length, 0);
  });
});
