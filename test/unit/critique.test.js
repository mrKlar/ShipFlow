import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runCritique } from "../../lib/critique.js";
import { createDecision, linkDecisionImpact } from "../../lib/decisions.js";
import { withTmpDir as tmpDir } from "../util/tmp.js";

const withTmpDir = (fn) => tmpDir("shipflow-critique", fn);

function writeUiCheck(tmp, file, body) {
  const dir = path.dirname(path.join(tmp, file));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(tmp, file), body);
}

const HAPPY_HOME = `
id: home
title: Renders the welcome heading on /
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

const HAPPY_LOGIN = `
id: login
title: User logs in successfully
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /login
assert:
  - text_equals:
      testid: heading
      equals: Logged in
`;

const NEGATIVE_LOGIN = `
id: login-error
title: Login shows error on invalid credentials
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

const VAGUE_TITLE_CHECK = `
id: works
title: works
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

const PLACEHOLDER_CHECK = `
id: todo-page
title: TODO page renders
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /todo
assert:
  - text_equals:
      testid: heading
      equals: "<some>"
`;

describe("critique", () => {
  it("returns score 0 / empty when no pack present", () => {
    withTmpDir(tmp => {
      const result = runCritique(tmp);
      assert.equal(result.summary.checks, 0);
      assert.equal(result.summary.score, 0);
      assert.equal(result.summary.level, "empty");
      assert.equal(result.ok, false);
    });
  });

  it("flags happy-path-only pack and lack of decision links", () => {
    withTmpDir(tmp => {
      writeUiCheck(tmp, "vp/ui/home.yml", HAPPY_HOME);
      writeUiCheck(tmp, "vp/ui/login.yml", HAPPY_LOGIN);
      const result = runCritique(tmp);
      const codes = new Set(result.findings.map(f => f.code));
      assert.ok(codes.has("critique.no_decision_link"));
      assert.ok(codes.has("critique.happy_path_only"));
      // Score should drop because of warnings
      assert.ok(result.summary.score < 100);
    });
  });

  it("does not flag happy_path_only when a negative case is present", () => {
    withTmpDir(tmp => {
      writeUiCheck(tmp, "vp/ui/home.yml", HAPPY_HOME);
      writeUiCheck(tmp, "vp/ui/login.yml", HAPPY_LOGIN);
      writeUiCheck(tmp, "vp/ui/login-error.yml", NEGATIVE_LOGIN);
      const result = runCritique(tmp);
      const codes = new Set(result.findings.map(f => f.code));
      assert.equal(codes.has("critique.happy_path_only"), false);
    });
  });

  it("flags vague titles", () => {
    withTmpDir(tmp => {
      writeUiCheck(tmp, "vp/ui/works.yml", VAGUE_TITLE_CHECK);
      writeUiCheck(tmp, "vp/ui/login-error.yml", NEGATIVE_LOGIN);
      const result = runCritique(tmp);
      const codes = result.findings.map(f => f.code);
      assert.ok(codes.includes("critique.vague_title"));
    });
  });

  it("flags placeholders as errors", () => {
    withTmpDir(tmp => {
      writeUiCheck(tmp, "vp/ui/todo-page.yml", PLACEHOLDER_CHECK);
      writeUiCheck(tmp, "vp/ui/login-error.yml", NEGATIVE_LOGIN);
      const result = runCritique(tmp);
      assert.ok(result.findings.some(f => f.code === "critique.placeholder_present" && f.level === "error"));
      assert.ok(result.summary.errors >= 1);
      assert.equal(result.ok, false);
    });
  });

  it("rewards decision linkage with score bump", () => {
    withTmpDir(tmp => {
      writeUiCheck(tmp, "vp/ui/home.yml", HAPPY_HOME);
      writeUiCheck(tmp, "vp/ui/login.yml", HAPPY_LOGIN);
      writeUiCheck(tmp, "vp/ui/login-error.yml", NEGATIVE_LOGIN);
      // baseline: no decisions
      const before = runCritique(tmp);

      createDecision(tmp, {
        id: "auth",
        title: "Auth flow",
        question: "Q",
        decision: "D",
        rationale: "R",
      });
      linkDecisionImpact(tmp, "auth", "vp/ui/home.yml");
      linkDecisionImpact(tmp, "auth", "vp/ui/login.yml");
      linkDecisionImpact(tmp, "auth", "vp/ui/login-error.yml");

      const after = runCritique(tmp);
      assert.ok(after.summary.score > before.summary.score, `expected score bump, before=${before.summary.score} after=${after.summary.score}`);
      assert.equal(after.summary.decision_linked_files, 3);
      assert.equal(after.summary.decision_linkage_ratio, 1);
    });
  });

  it("flags unlinked decisions", () => {
    withTmpDir(tmp => {
      writeUiCheck(tmp, "vp/ui/home.yml", HAPPY_HOME);
      writeUiCheck(tmp, "vp/ui/login-error.yml", NEGATIVE_LOGIN);
      createDecision(tmp, {
        id: "lone",
        title: "Lonely",
        question: "Q",
        decision: "D",
        rationale: "R",
      });
      const result = runCritique(tmp);
      assert.ok(result.findings.some(f => f.code === "critique.decision_unlinked"));
    });
  });
});
