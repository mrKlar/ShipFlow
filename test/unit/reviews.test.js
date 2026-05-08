import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createReview,
  loadReviews,
  findReview,
  resolveReview,
  reopenReview,
  listConcreteArtifacts,
  previewArtifacts,
  reviewArtifactCli,
  reviewsDir,
} from "../../lib/reviews.js";
import { createSlice } from "../../lib/slices.js";
import { createDecision } from "../../lib/decisions.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-reviews-"));
  try {
    return fn(tmpDir);
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

describe("reviews", () => {
  it("creates a review with default kind/status/reviewer", () => {
    withTmpDir(tmp => {
      const { review, file } = createReview(tmp, {
        target: "vp/ui/home.yml",
        target_kind: "vp",
        text: "The empty state copy is too generic.",
      });
      assert.ok(fs.existsSync(file));
      assert.equal(review.kind, "concern");
      assert.equal(review.status, "open");
      assert.ok(review.reviewer);
      assert.equal(review.target, "vp/ui/home.yml");
    });
  });

  it("rejects invalid target_kind", () => {
    withTmpDir(tmp => {
      assert.throws(() => createReview(tmp, {
        target: "x",
        target_kind: "bogus",
        text: "T",
      }));
    });
  });

  it("resolveReview marks resolved with notes", () => {
    withTmpDir(tmp => {
      const { review } = createReview(tmp, {
        target: "vp/api/users.yml",
        target_kind: "vp",
        text: "Need pagination contract.",
      });
      const { review: after } = resolveReview(tmp, review.id, {
        resolved_by: "nic",
        resolution_notes: "Added cursor pagination to the api check.",
      });
      assert.equal(after.status, "resolved");
      assert.equal(after.resolved_by, "nic");
      assert.match(after.resolution_notes, /cursor pagination/);
      assert.ok(after.resolved_at);
    });
  });

  it("resolveReview supports wont_fix", () => {
    withTmpDir(tmp => {
      const { review } = createReview(tmp, {
        target: "vp/ui/home.yml",
        target_kind: "vp",
        text: "Use red color.",
      });
      const { review: after } = resolveReview(tmp, review.id, { status: "wont_fix" });
      assert.equal(after.status, "wont_fix");
    });
  });

  it("reopenReview clears resolution metadata", () => {
    withTmpDir(tmp => {
      const { review } = createReview(tmp, { target: "x", target_kind: "vp", text: "T" });
      resolveReview(tmp, review.id, { resolved_by: "nic" });
      reopenReview(tmp, review.id);
      const r = findReview(tmp, review.id);
      assert.equal(r.status, "open");
      assert.equal(r.resolved_at, undefined);
      assert.equal(r.resolved_by, undefined);
    });
  });

  it("listConcreteArtifacts surfaces vp, slice, and decision items", () => {
    withTmpDir(tmp => {
      fs.mkdirSync(path.join(tmp, "vp", "ui"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "vp", "ui", "home.yml"), "id: home\n");
      createSlice(tmp, { id: "main", goal: "Main flow works" });
      createDecision(tmp, {
        id: "auth",
        title: "Auth",
        question: "Q",
        decision: "D",
        rationale: "R",
      });
      const artifacts = listConcreteArtifacts(tmp);
      const kinds = new Set(artifacts.map(a => a.kind));
      assert.ok(kinds.has("vp"));
      assert.ok(kinds.has("slice"));
      assert.ok(kinds.has("decision"));
    });
  });

  it("previewArtifacts handles empty repo gracefully", () => {
    withTmpDir(tmp => {
      const { result, stdout } = captureStdio(() => previewArtifacts({ cwd: tmp }));
      assert.equal(result.exitCode, 0);
      assert.match(stdout, /No concrete artifacts/);
    });
  });

  it("CLI: new without required flags returns 2", () => {
    withTmpDir(tmp => {
      const { result } = captureStdio(() => reviewArtifactCli({
        cwd: tmp,
        args: ["new", "--target=x"],
      }));
      assert.equal(result.exitCode, 2);
    });
  });

  it("CLI: list filters by status", () => {
    withTmpDir(tmp => {
      const a = createReview(tmp, { target: "vp/ui/a.yml", target_kind: "vp", text: "A" });
      createReview(tmp, { target: "vp/ui/b.yml", target_kind: "vp", text: "B" });
      resolveReview(tmp, a.review.id);

      const open = captureStdio(() => reviewArtifactCli({
        cwd: tmp,
        args: ["list", "--status=open"],
        json: true,
      }));
      const parsedOpen = JSON.parse(open.stdout);
      assert.equal(parsedOpen.reviews.length, 1);
      assert.equal(parsedOpen.reviews[0].text, "B");

      const resolved = captureStdio(() => reviewArtifactCli({
        cwd: tmp,
        args: ["list", "--status=resolved"],
        json: true,
      }));
      const parsedResolved = JSON.parse(resolved.stdout);
      assert.equal(parsedResolved.reviews.length, 1);
      assert.equal(parsedResolved.reviews[0].id, a.review.id);
    });
  });

  it("CLI: resolve sets resolved status", () => {
    withTmpDir(tmp => {
      const { review } = createReview(tmp, { target: "x", target_kind: "vp", text: "T" });
      const { result } = captureStdio(() => reviewArtifactCli({
        cwd: tmp,
        args: ["resolve", review.id, "--resolved-by=nic", "--resolution-notes=Fixed"],
      }));
      assert.equal(result.exitCode, 0);
      const r = findReview(tmp, review.id);
      assert.equal(r.status, "resolved");
      assert.equal(r.resolved_by, "nic");
    });
  });

  it("loadReviews flags malformed yaml", () => {
    withTmpDir(tmp => {
      const dir = reviewsDir(tmp);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "broken.yml"), "id: bad\n: not yaml");
      const { issues } = loadReviews(tmp);
      assert.ok(issues.length > 0);
    });
  });
});
