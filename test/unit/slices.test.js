import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createSlice,
  loadSlices,
  findSlice,
  linkSlice,
  unlinkSlice,
  updateSlice,
  deriveSliceProgress,
  slicesCli,
  slicesDir,
} from "../../lib/slices.js";
import { createDecision } from "../../lib/decisions.js";
import { createGrillSession } from "../../lib/grill.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-slices-"));
  try {
    return fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function withTmpDirAsync(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-slices-"));
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

describe("slices", () => {
  it("creates a slice with goal and persists yaml", () => {
    withTmpDir(tmp => {
      const { file, slice } = createSlice(tmp, {
        id: "session-expiry",
        goal: "User is safely logged out after 30 minutes of inactivity.",
        status: "planned",
        vp: ["vp/security/session.yml"],
      });
      assert.ok(fs.existsSync(file));
      assert.equal(slice.id, "session-expiry");
      assert.deepEqual(slice.vp, ["vp/security/session.yml"]);
      const { items } = loadSlices(tmp);
      assert.equal(items.length, 1);
    });
  });

  it("rejects duplicate slice ids", () => {
    withTmpDir(tmp => {
      createSlice(tmp, { id: "x", goal: "G" });
      assert.throws(() => createSlice(tmp, { id: "x", goal: "G2" }), /already exists/);
    });
  });

  it("link adds vp/decisions/grill_refs idempotently", async () => {
    await withTmpDirAsync(async (tmp) => {
      createDecision(tmp, {
        id: "d1",
        title: "T",
        question: "Q",
        decision: "D",
        rationale: "R",
      });
      const { session } = await createGrillSession(tmp, { intent: "Anything", role: "general" });
      createSlice(tmp, { id: "slice", goal: "G" });

      linkSlice(tmp, "slice", { vp: ["vp/ui/home.yml"], decisions: ["d1"], grill_refs: [session.id] });
      let s = findSlice(tmp, "slice");
      assert.deepEqual(s.vp, ["vp/ui/home.yml"]);
      assert.deepEqual(s.decisions, ["d1"]);
      assert.deepEqual(s.grill_refs, [session.id]);

      // idempotent
      linkSlice(tmp, "slice", { vp: ["vp/ui/home.yml"], decisions: ["d1"] });
      s = findSlice(tmp, "slice");
      assert.deepEqual(s.vp, ["vp/ui/home.yml"]);
      assert.equal(s.decisions.length, 1);
    });
  });

  it("link rejects unknown decision ids", () => {
    withTmpDir(tmp => {
      createSlice(tmp, { id: "slice", goal: "G" });
      assert.throws(() => linkSlice(tmp, "slice", { decisions: ["nonexistent"] }), /Decision not found/);
    });
  });

  it("unlink removes only listed entries", () => {
    withTmpDir(tmp => {
      createDecision(tmp, { id: "a", title: "T", question: "Q", decision: "D", rationale: "R" });
      createDecision(tmp, { id: "b", title: "T", question: "Q", decision: "D", rationale: "R" });
      createSlice(tmp, { id: "slice", goal: "G" });
      linkSlice(tmp, "slice", { decisions: ["a", "b"], vp: ["vp/x.yml", "vp/y.yml"] });

      unlinkSlice(tmp, "slice", { decisions: ["a"], vp: ["vp/x.yml"] });
      const s = findSlice(tmp, "slice");
      assert.deepEqual(s.decisions, ["b"]);
      assert.deepEqual(s.vp, ["vp/y.yml"]);
    });
  });

  it("deriveSliceProgress reflects VP and evidence presence", () => {
    withTmpDir(tmp => {
      fs.mkdirSync(path.join(tmp, "vp", "ui"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "vp", "ui", "home.yml"), "id: home\n");
      fs.mkdirSync(path.join(tmp, "evidence"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "evidence", "run.json"), "{}");

      createSlice(tmp, {
        id: "slice",
        goal: "G",
        vp: ["vp/ui/home.yml", "vp/api/users.yml"],
        evidence: ["evidence/run.json", "evidence/missing.json"],
      });
      const slice = findSlice(tmp, "slice");
      const p = deriveSliceProgress(tmp, slice);
      assert.equal(p.vp_total, 2);
      assert.equal(p.vp_present, 1);
      assert.equal(p.evidence_total, 2);
      assert.equal(p.evidence_present, 1);
    });
  });

  it("updateSlice updates updated_at", () => {
    withTmpDir(tmp => {
      createSlice(tmp, { id: "slice", goal: "G" });
      updateSlice(tmp, "slice", next => { next.notes = "tweak"; });
      const s = findSlice(tmp, "slice");
      assert.equal(s.notes, "tweak");
      assert.ok(s.updated_at);
    });
  });

  it("CLI: list returns json", () => {
    withTmpDir(tmp => {
      createSlice(tmp, { id: "a", goal: "Goal A" });
      const { result, stdout } = captureStdio(() => slicesCli({
        cwd: tmp,
        args: ["list"],
        json: true,
      }));
      assert.equal(result.exitCode, 0);
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.slices.length, 1);
      assert.equal(parsed.slices[0].id, "a");
      assert.ok(parsed.slices[0].progress);
    });
  });

  it("CLI: new validates required flags", () => {
    withTmpDir(tmp => {
      const { result, stderr } = captureStdio(() => slicesCli({
        cwd: tmp,
        args: ["new", "--id=x"],
      }));
      assert.equal(result.exitCode, 2);
      assert.match(stderr, /Missing required flags/);
    });
  });

  it("CLI: set-status changes the status", () => {
    withTmpDir(tmp => {
      createSlice(tmp, { id: "slice", goal: "G" });
      const { result } = captureStdio(() => slicesCli({
        cwd: tmp,
        args: ["set-status", "slice", "--status=in-progress"],
      }));
      assert.equal(result.exitCode, 0);
      assert.equal(findSlice(tmp, "slice").status, "in-progress");
    });
  });

  it("CLI: set-status rejects unknown status", () => {
    withTmpDir(tmp => {
      createSlice(tmp, { id: "slice", goal: "G" });
      const { result, stderr } = captureStdio(() => slicesCli({
        cwd: tmp,
        args: ["set-status", "slice", "--status=floating"],
      }));
      assert.equal(result.exitCode, 2);
      assert.match(stderr, /must be one of/);
    });
  });

  it("CLI: show on missing slice returns 1", () => {
    withTmpDir(tmp => {
      const { result } = captureStdio(() => slicesCli({
        cwd: tmp,
        args: ["show", "nope"],
      }));
      assert.equal(result.exitCode, 1);
    });
  });

  it("loadSlices flags dangling decision references", async () => {
    await withTmpDirAsync(async (tmp) => {
      // Slice references a decision id that does not exist
      createSlice(tmp, { id: "s1", goal: "G", decisions: ["ghost-decision"] });
      const { issues } = loadSlices(tmp);
      assert.ok(issues.some(i => i.code === "slice.dangling_decision"));
    });
  });

  it("loadSlices flags dangling grill_ref references", async () => {
    await withTmpDirAsync(async (tmp) => {
      createSlice(tmp, { id: "s1", goal: "G", grill_refs: ["ghost-grill-session"] });
      const { issues } = loadSlices(tmp);
      assert.ok(issues.some(i => i.code === "slice.dangling_grill_ref"));
    });
  });

  it("loadSlices accepts injected id sets to avoid re-reading disk", () => {
    withTmpDir(tmp => {
      // Reference decisions that exist in the injected set, even though no decision files are on disk
      createSlice(tmp, { id: "s1", goal: "G", decisions: ["d1"] });
      const { issues } = loadSlices(tmp, {
        decisionIds: new Set(["d1"]),
        grillIds: new Set(),
      });
      assert.equal(issues.filter(i => i.code === "slice.dangling_decision").length, 0);
    });
  });

  it("loadSlices reports duplicate id issue", () => {
    withTmpDir(tmp => {
      const dir = slicesDir(tmp);
      fs.mkdirSync(dir, { recursive: true });
      const body = (id) => `id: ${id}\ngoal: G\nstatus: proposed\nvp: []\ndecisions: []\ngrill_refs: []\nevidence: []\n`;
      fs.writeFileSync(path.join(dir, "a.yml"), body("dup"));
      fs.writeFileSync(path.join(dir, "b.yml"), body("dup"));
      const { issues } = loadSlices(tmp);
      assert.ok(issues.some(i => i.code === "slice.duplicate_id"));
    });
  });
});
