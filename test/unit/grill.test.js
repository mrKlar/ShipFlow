import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createGrillSession,
  loadGrillSessions,
  findGrillSession,
  buildGrillPrompt,
  buildLocalGrillTemplate,
  grillCli,
  grillDir,
} from "../../lib/grill.js";
import { loadDecisions } from "../../lib/decisions.js";

async function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-grill-"));
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
  return Promise.resolve(fn()).then(result => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    console.log = origLog;
    console.error = origErrLog;
    return { result, stdout: out.join(""), stderr: err.join("") };
  }, err => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    console.log = origLog;
    console.error = origErrLog;
    throw err;
  });
}

describe("grill", () => {
  it("buildLocalGrillTemplate returns at least 3 questions and 1 finding", () => {
    const t = buildLocalGrillTemplate({ intent: "anything", role: "general" });
    assert.ok(t.questions.length >= 3);
    assert.ok(t.findings.length >= 1);
    assert.equal(Array.isArray(t.proposed_decisions), true);
  });

  it("buildGrillPrompt embeds the intent and role and the JSON contract", () => {
    const prompt = buildGrillPrompt({ intent: "Build retroactive points refund", role: "security" });
    assert.match(prompt, /retroactive points refund/);
    assert.match(prompt, /Active role lens: security/);
    assert.match(prompt, /Return ONLY valid JSON/);
    assert.match(prompt, /proposed_decisions/);
  });

  it("creates an offline session and writes md + json", async () => {
    await withTmpDir(async (tmp) => {
      const { session, jsonFile, mdFile } = await createGrillSession(tmp, {
        intent: "Add session inactivity timeout",
        role: "security",
      });
      assert.ok(fs.existsSync(jsonFile));
      assert.ok(fs.existsSync(mdFile));
      assert.equal(session.role, "security");
      assert.match(session.id, /add-session-inactivity-timeout-/);
      const md = fs.readFileSync(mdFile, "utf-8");
      assert.match(md, /# Grill — Add session inactivity timeout/);
      assert.match(md, /## Questions \(\d+\)/);
    });
  });

  it("creates an AI session using a stubbed provider that returns JSON", async () => {
    await withTmpDir(async (tmp) => {
      const fakeJson = JSON.stringify({
        questions: [{ id: "q-x", topic: "outcome", question: "What outcome?", why_it_matters: "Z" }],
        findings: [{ id: "f-x", kind: "edge_case", text: "Network drop mid-write" }],
        proposed_decisions: [{
          id: "consent",
          type: "security",
          title: "Consent",
          question: "Should we ask?",
          decision: "Yes",
          rationale: "Compliance",
          impacts: ["vp/security/consent.yml"],
        }],
        follow_ups: ["Review legal"],
      });
      const generateText = async () => fakeJson;
      const { session } = await createGrillSession(tmp, {
        intent: "Add data export consent",
        role: "security",
        ai: true,
        generateText,
      });
      assert.equal(session.questions.length, 1);
      assert.equal(session.findings.length, 1);
      assert.equal(session.proposed_decisions.length, 1);
      assert.equal(session.proposed_decisions[0].id, "consent");
    });
  });

  it("AI session that returns malformed JSON throws a clear error", async () => {
    await withTmpDir(async (tmp) => {
      const generateText = async () => "I am not JSON, sorry.";
      await assert.rejects(() => createGrillSession(tmp, {
        intent: "Anything",
        role: "general",
        ai: true,
        generateText,
      }), /non-JSON output/);
    });
  });

  it("rejects empty intent", async () => {
    await withTmpDir(async (tmp) => {
      await assert.rejects(() => createGrillSession(tmp, { intent: "" }), /intent is required/);
    });
  });

  it("CLI: list with no sessions prints helpful hint", async () => {
    await withTmpDir(async (tmp) => {
      const { result, stdout } = await captureStdio(() => grillCli({ cwd: tmp, args: ["list"] }));
      assert.equal(result.exitCode, 0);
      assert.match(stdout, /No grill sessions yet/);
    });
  });

  it("CLI: default subcommand creates a session from positional intent", async () => {
    await withTmpDir(async (tmp) => {
      const { result } = await captureStdio(() => grillCli({
        cwd: tmp,
        args: ["Add", "session", "inactivity", "timeout"],
      }));
      assert.equal(result.exitCode, 0);
      const { items } = loadGrillSessions(tmp);
      assert.equal(items.length, 1);
      assert.match(items[0].intent, /Add session inactivity timeout/);
    });
  });

  it("CLI: promote turns a proposed decision into a decision file", async () => {
    await withTmpDir(async (tmp) => {
      const { session } = await createGrillSession(tmp, {
        intent: "Whatever",
        role: "general",
        ai: true,
        generateText: async () => JSON.stringify({
          questions: [],
          findings: [],
          proposed_decisions: [{
            id: "retention-30",
            type: "data",
            title: "30-day retention",
            question: "How long?",
            decision: "30 days",
            rationale: "GDPR friendly",
            impacts: ["vp/db/retention.yml"],
          }],
          follow_ups: [],
        }),
      });
      const { result } = await captureStdio(() => grillCli({
        cwd: tmp,
        args: ["promote", session.id, "--decision=retention-30"],
      }));
      assert.equal(result.exitCode, 0);
      const { items } = loadDecisions(tmp);
      assert.equal(items.length, 1);
      assert.equal(items[0].id, "retention-30");
      assert.equal(items[0].source, "grill");
      assert.equal(items[0].source_ref, session.id);
    });
  });

  it("CLI: show on missing session returns 1", async () => {
    await withTmpDir(async (tmp) => {
      const { result } = await captureStdio(() => grillCli({ cwd: tmp, args: ["show", "missing-id"] }));
      assert.equal(result.exitCode, 1);
    });
  });

  it("CLI: usage with no intent prints error and returns 2", async () => {
    await withTmpDir(async (tmp) => {
      const { result, stderr } = await captureStdio(() => grillCli({ cwd: tmp, args: ["new"] }));
      assert.equal(result.exitCode, 2);
      assert.match(stderr, /usage:/);
    });
  });

  it("findGrillSession returns null when missing", async () => {
    await withTmpDir(async (tmp) => {
      assert.equal(findGrillSession(tmp, "nope"), null);
    });
  });

  it("loadGrillSessions reports issues for malformed json", async () => {
    await withTmpDir(async (tmp) => {
      const dir = grillDir(tmp);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "broken-2026-01-01T00-00-00Z.json"), "{not json");
      const { issues } = loadGrillSessions(tmp);
      assert.ok(issues.length > 0);
      assert.equal(issues[0].code, "json.parse_error");
    });
  });
});
