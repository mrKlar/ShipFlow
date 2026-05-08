import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createGrillSession,
  createMultiGrillSession,
  loadGrillSessions,
  findGrillSession,
  grillCli,
  grillDir,
} from "../../lib/grill.js";
import { loadDecisions } from "../../lib/decisions.js";
import { withTmpDirAsync } from "../util/tmp.js";
import { captureStdio } from "../util/stdio.js";

const withTmpDir = (fn) => withTmpDirAsync("shipflow-grill", fn);

describe("grill", () => {
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

  it("createGrillSession rejects unknown role", async () => {
    await withTmpDir(async (tmp) => {
      await assert.rejects(() => createGrillSession(tmp, { intent: "x", role: "captain" }), /role must be one of/);
    });
  });

  it("createMultiGrillSession fans out to all 5 specialist roles with unique ids", async () => {
    await withTmpDir(async (tmp) => {
      const { sessions, roles } = await createMultiGrillSession(tmp, {
        intent: "Add multi-tenant rate limit to /api/jobs",
      });
      assert.deepEqual(roles, ["product", "architecture", "qa", "security", "risk"]);
      assert.equal(sessions.length, 5);
      const ids = sessions.map(s => s.session.id);
      assert.equal(new Set(ids).size, 5, "five distinct ids despite same-ms creation");
      // Each session embeds its role in its id and is loadable
      for (const { session } of sessions) {
        assert.match(session.id, new RegExp(`-${session.role}$`));
        assert.ok(findGrillSession(tmp, session.id));
      }
    });
  });

  it("CLI: --multi creates 5 sessions and rejects --role", async () => {
    await withTmpDir(async (tmp) => {
      const { result } = await captureStdio(() => grillCli({
        cwd: tmp,
        args: ["--multi", "--intent=Add session expiry to admin console"],
      }));
      assert.equal(result.exitCode, 0);
      const { items } = loadGrillSessions(tmp);
      assert.equal(items.length, 5);
      const roles = new Set(items.map(s => s.role));
      assert.deepEqual([...roles].sort(), ["architecture", "product", "qa", "risk", "security"]);

      // --multi + --role is incoherent
      const conflict = await captureStdio(() => grillCli({
        cwd: tmp,
        args: ["--multi", "--role=security", "--intent=anything"],
      }));
      assert.equal(conflict.result.exitCode, 2);
      assert.match(conflict.stderr, /--multi cannot be combined with --role/);
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
