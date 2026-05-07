import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import {
  createDecision,
  loadDecisions,
  findDecision,
  linkDecisionImpact,
  unlinkDecisionImpact,
  decisionsCli,
  decisionsDir,
} from "../../lib/decisions.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-decisions-"));
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

describe("decisions", () => {
  it("creates and reloads a decision", () => {
    withTmpDir(tmp => {
      const { file, decision } = createDecision(tmp, {
        id: "auth-session-expiry",
        title: "Session inactivity timeout",
        question: "Should sessions expire after inactivity?",
        decision: "Yes, after 30 minutes of inactivity.",
        rationale: "PCI/security expectation for admin surfaces.",
        type: "security",
        source: "grill",
        impacts: ["vp/security/session-timeout.yml"],
      });
      assert.ok(fs.existsSync(file));
      assert.equal(decision.id, "auth-session-expiry");
      assert.equal(decision.type, "security");
      assert.deepEqual(decision.impacts, ["vp/security/session-timeout.yml"]);

      const loaded = loadDecisions(tmp);
      assert.equal(loaded.issues.length, 0);
      assert.equal(loaded.items.length, 1);
      assert.equal(loaded.items[0].id, "auth-session-expiry");
    });
  });

  it("rejects duplicate ids", () => {
    withTmpDir(tmp => {
      createDecision(tmp, {
        id: "x",
        title: "T",
        question: "Q",
        decision: "D",
        rationale: "R",
      });
      assert.throws(() => createDecision(tmp, {
        id: "x",
        title: "T2",
        question: "Q2",
        decision: "D2",
        rationale: "R2",
      }), /already exists/);
    });
  });

  it("links and unlinks impacts to a vp file", () => {
    withTmpDir(tmp => {
      createDecision(tmp, {
        id: "retention",
        title: "Retention",
        question: "How long?",
        decision: "30 days",
        rationale: "GDPR friendly",
      });
      linkDecisionImpact(tmp, "retention", "vp/db/retention.yml");
      let d = findDecision(tmp, "retention");
      assert.deepEqual(d.impacts, ["vp/db/retention.yml"]);

      // Linking the same path again should be idempotent
      linkDecisionImpact(tmp, "retention", "vp/db/retention.yml");
      d = findDecision(tmp, "retention");
      assert.deepEqual(d.impacts, ["vp/db/retention.yml"]);

      linkDecisionImpact(tmp, "retention", "vp/api/retention.yml");
      d = findDecision(tmp, "retention");
      assert.deepEqual(d.impacts.sort(), ["vp/api/retention.yml", "vp/db/retention.yml"]);

      unlinkDecisionImpact(tmp, "retention", "vp/db/retention.yml");
      d = findDecision(tmp, "retention");
      assert.deepEqual(d.impacts, ["vp/api/retention.yml"]);
    });
  });

  it("rejects invalid id format", () => {
    withTmpDir(tmp => {
      assert.throws(() => createDecision(tmp, {
        id: "Bad ID!",
        title: "T",
        question: "Q",
        decision: "D",
        rationale: "R",
      }));
    });
  });

  it("reports issues for malformed yaml", () => {
    withTmpDir(tmp => {
      const dir = decisionsDir(tmp);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "0001-broken.yml"), "id: bad\n  : not yaml\n  - oops");
      const { issues } = loadDecisions(tmp);
      assert.ok(issues.length > 0);
      assert.equal(issues[0].code, "yaml.parse_error");
    });
  });

  it("flags duplicate ids across files", () => {
    withTmpDir(tmp => {
      const dir = decisionsDir(tmp);
      fs.mkdirSync(dir, { recursive: true });
      const body = (id) => yaml.dump({
        id,
        type: "product",
        status: "accepted",
        title: "X",
        question: "Y",
        decision: "Z",
        rationale: "R",
        source: "manual",
        impacts: [],
      });
      fs.writeFileSync(path.join(dir, "0001-a.yml"), body("dup"));
      fs.writeFileSync(path.join(dir, "0002-b.yml"), body("dup"));
      const { issues } = loadDecisions(tmp);
      assert.ok(issues.some(i => i.code === "decision.duplicate_id"));
    });
  });

  it("CLI: new requires required flags and writes file", () => {
    withTmpDir(tmp => {
      const fail = captureStdio(() => decisionsCli({
        cwd: tmp,
        args: ["new", "--id=x", "--title=t"],
      }));
      assert.equal(fail.result.exitCode, 2);
      assert.match(fail.stderr, /Missing required flags/);

      const ok = captureStdio(() => decisionsCli({
        cwd: tmp,
        args: [
          "new",
          "--id=login-redirect",
          "--title=Login redirect",
          "--question=Where to send users after login?",
          "--decision=Send to /dashboard",
          "--rationale=Most common user goal",
          "--source=grill",
        ],
      }));
      assert.equal(ok.result.exitCode, 0);
      const { items } = loadDecisions(tmp);
      assert.equal(items.length, 1);
      assert.equal(items[0].id, "login-redirect");
    });
  });

  it("CLI: list emits json", () => {
    withTmpDir(tmp => {
      createDecision(tmp, {
        id: "a",
        title: "A",
        question: "Q",
        decision: "D",
        rationale: "R",
      });
      const { result, stdout } = captureStdio(() => decisionsCli({
        cwd: tmp,
        args: ["list"],
        json: true,
      }));
      assert.equal(result.exitCode, 0);
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.decisions.length, 1);
      assert.equal(parsed.decisions[0].id, "a");
      assert.equal(parsed.issues.length, 0);
    });
  });

  it("CLI: show returns 1 when missing", () => {
    withTmpDir(tmp => {
      const { result } = captureStdio(() => decisionsCli({
        cwd: tmp,
        args: ["show", "missing"],
      }));
      assert.equal(result.exitCode, 1);
    });
  });

  it("CLI: link adds impact via vp flag", () => {
    withTmpDir(tmp => {
      createDecision(tmp, {
        id: "consent",
        title: "Consent",
        question: "Q",
        decision: "D",
        rationale: "R",
      });
      const { result } = captureStdio(() => decisionsCli({
        cwd: tmp,
        args: ["link", "consent", "--vp=vp/security/consent.yml"],
      }));
      assert.equal(result.exitCode, 0);
      const d = findDecision(tmp, "consent");
      assert.deepEqual(d.impacts, ["vp/security/consent.yml"]);
    });
  });

  it("CLI: unknown subcommand returns 2", () => {
    withTmpDir(tmp => {
      const { result } = captureStdio(() => decisionsCli({
        cwd: tmp,
        args: ["whatever"],
      }));
      assert.equal(result.exitCode, 2);
    });
  });
});
