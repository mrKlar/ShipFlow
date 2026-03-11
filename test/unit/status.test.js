import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeVerificationPackSnapshot } from "../../lib/util/vp-snapshot.js";
import { collectStatus, status } from "../../lib/status.js";

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

  it("returns machine-readable status when json output is requested", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "vp", "domain"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".shipflow"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "evidence"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\n");
    fs.writeFileSync(path.join(tmpDir, "vp", "domain", "todo.yml"), "id: domain-todo\n");
    fs.writeFileSync(path.join(tmpDir, ".shipflow", "draft-session.json"), JSON.stringify({
      version: 1,
      request: "todo app",
      review: { accepted: 1, rejected: 0, pending: 2, suggested_write: 1 },
      proposals: [],
    }));
    fs.writeFileSync(path.join(tmpDir, "evidence", "run.json"), JSON.stringify({
      version: 1,
      ok: true,
      duration_ms: 1200,
      started_at: "2026-03-08T12:00:00.000Z",
      passed: 3,
      failed: 0,
      groups: [{ label: "ui", ok: true, skipped: false }],
    }));
    try {
      const output = captureStatusOutput(() => status({ cwd: tmpDir, json: true }));
      const parsed = JSON.parse(output);
      assert.equal(parsed.verifications.ui, 1);
      assert.equal(parsed.verifications.domain, 1);
      assert.equal(parsed.draft_session.request, "todo app");
      assert.equal(parsed.draft_session.review.pending, 2);
      assert.equal(parsed.draft_session.ready_for_implement, false);
      assert.equal(parsed.implementation_gate.ready, false);
      assert.equal(parsed.implementation_gate.source, "draft_session");
      assert.equal(parsed.evidence.run.ok, true);
      assert.equal(parsed.evidence.run.groups[0].label, "ui");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("marks draft status as blocked when accepted proposals are not written yet", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    fs.mkdirSync(path.join(tmpDir, ".shipflow"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".shipflow", "draft-session.json"), JSON.stringify({
      version: 1,
      request: "todo app",
      review: { accepted: 1, rejected: 0, pending: 0, suggested_write: 1 },
      proposals: [{
        path: "vp/ui/home.yml",
        type: "ui",
        confidence: "high",
        review: { decision: "accept", suggested_write: true },
        data: {
          id: "ui-home",
          title: "Home screen is visible",
          severity: "blocker",
          app: { kind: "web", base_url: "http://localhost:3000" },
          flow: [{ open: "/" }],
          assert: [{ visible: { testid: "home" } }],
        },
      }],
    }));
    try {
      const parsed = collectStatus(tmpDir);
      assert.equal(parsed.draft_session.ready_for_implement, false);
      assert.equal(parsed.implementation_gate.ready, false);
      assert.equal(parsed.draft_session.accepted_unwritten, 1);
      assert.equal(parsed.draft_session.accepted_unwritten_paths[0], "vp/ui/home.yml");
      assert.match(parsed.draft_session.blocking_reasons[0], /not yet written/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("marks draft status as ready when accepted proposals already match vp files", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".shipflow"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), [
      "id: ui-home",
      "title: Home screen is visible",
      "severity: blocker",
      "app:",
      "  kind: web",
      "  base_url: http://localhost:3000",
      "flow:",
      "  - open: /",
      "assert:",
      "  - visible:",
      "      testid: home",
      "",
    ].join("\n"));
    const vpSnapshot = computeVerificationPackSnapshot(tmpDir);
    fs.writeFileSync(path.join(tmpDir, ".shipflow", "draft-session.json"), JSON.stringify({
      version: 1,
      request: "todo app",
      review: { accepted: 1, rejected: 0, pending: 0, suggested_write: 1 },
      vp_snapshot: vpSnapshot,
      proposals: [{
        path: "vp/ui/home.yml",
        type: "ui",
        confidence: "high",
        review: { decision: "accept", suggested_write: true },
        data: {
          id: "ui-home",
          title: "Home screen is visible",
          severity: "blocker",
          app: { kind: "web", base_url: "http://localhost:3000" },
          flow: [{ open: "/" }],
          assert: [{ visible: { testid: "home" } }],
        },
      }],
    }));
    try {
      const parsed = collectStatus(tmpDir);
      assert.equal(parsed.draft_session.ready_for_implement, true);
      assert.equal(parsed.implementation_gate.ready, true);
      assert.equal(parsed.draft_session.accepted_unwritten, 0);
      assert.equal(parsed.draft_session.stale, false);
      assert.deepEqual(parsed.draft_session.blocking_reasons, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("marks draft status as stale when vp files diverge from the saved pack snapshot", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".shipflow"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), [
      "id: ui-home",
      "title: Home screen is visible",
      "severity: blocker",
      "app:",
      "  kind: web",
      "  base_url: http://localhost:3000",
      "flow:",
      "  - open: /",
      "assert:",
      "  - visible:",
      "      testid: home",
      "",
    ].join("\n"));
    const reviewedSnapshot = computeVerificationPackSnapshot(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), [
      "id: ui-home",
      "title: Home screen is visible",
      "severity: blocker",
      "app:",
      "  kind: web",
      "  base_url: http://localhost:3000",
      "flow:",
      "  - open: /",
      "assert:",
      "  - visible:",
      "      testid: changed-home",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(tmpDir, ".shipflow", "draft-session.json"), JSON.stringify({
      version: 1,
      request: "todo app",
      review: { accepted: 1, rejected: 0, pending: 0, suggested_write: 1 },
      vp_snapshot: reviewedSnapshot,
      proposals: [{
        path: "vp/ui/home.yml",
        type: "ui",
        confidence: "high",
        review: { decision: "accept", suggested_write: true },
        data: {
          id: "ui-home",
          title: "Home screen is visible",
          severity: "blocker",
          app: { kind: "web", base_url: "http://localhost:3000" },
          flow: [{ open: "/" }],
          assert: [{ visible: { testid: "home" } }],
        },
      }],
    }));
    try {
      const parsed = collectStatus(tmpDir);
      assert.equal(parsed.draft_session.stale, true);
      assert.equal(parsed.draft_session.ready_for_implement, false);
      assert.equal(parsed.implementation_gate.ready, false);
      assert.equal(parsed.draft_session.stale_paths[0], "vp/ui/home.yml");
      assert.ok(parsed.draft_session.blocking_reasons.some(reason => /changed after the last saved draft session/i.test(reason)));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("marks the implementation gate ready when a verification pack exists without a draft session", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\n");
    try {
      const parsed = collectStatus(tmpDir);
      assert.equal(parsed.draft_session, null);
      assert.equal(parsed.implementation_gate.ready, true);
      assert.equal(parsed.implementation_gate.source, "verification_pack");
      assert.deepEqual(parsed.implementation_gate.blocking_reasons, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
