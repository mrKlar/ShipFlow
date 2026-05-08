import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, "..", "..", "templates", "github-actions", "shipflow-pr.yml");

describe("templates/github-actions/shipflow-pr.yml — workflow shape", () => {
  it("parses as valid YAML", () => {
    const body = fs.readFileSync(templatePath, "utf-8");
    assert.doesNotThrow(() => yaml.load(body));
  });

  it("declares the right top-level structure", () => {
    const wf = yaml.load(fs.readFileSync(templatePath, "utf-8"));
    assert.equal(wf.name, "ShipFlow PR checks");
    // GitHub parses YAML's `on:` as boolean true unless quoted, so accept both
    const on = wf.on ?? wf[true];
    assert.ok(on, "workflow must have an `on` trigger");
    assert.ok(on.pull_request, "must trigger on pull_request");
    assert.deepEqual(on.pull_request.branches, ["main"]);
  });

  it("requests pull-requests: write so the trace comment can post", () => {
    const wf = yaml.load(fs.readFileSync(templatePath, "utf-8"));
    assert.equal(wf.permissions["pull-requests"], "write");
    assert.equal(wf.permissions["contents"], "read");
  });

  it("runs lint, critique with a threshold, optional governance, and trace --pr-comment", () => {
    const wf = yaml.load(fs.readFileSync(templatePath, "utf-8"));
    const job = wf.jobs.shipflow;
    assert.ok(job, "must have the shipflow job");
    const stepNames = job.steps.map(s => s.name || s.uses || "(unnamed)");
    const runs = job.steps.filter(s => typeof s.run === "string").map(s => s.run).join("\n");

    assert.ok(stepNames.some(n => /shipflow lint/i.test(n)), "must run lint");
    assert.match(runs, /shipflow lint/);
    assert.match(runs, /shipflow critique --threshold=/);
    assert.match(runs, /shipflow trace --pr-comment/);

    // Governance step is conditional on .shipflow/governance.yml existing
    const govStep = job.steps.find(s => /governance check/i.test(s.name || ""));
    assert.ok(govStep, "must include a governance check step");
    assert.match(govStep.if || "", /\.shipflow\/governance\.yml/);
  });

  it("uses the find-then-update comment pattern with a stable marker", () => {
    const body = fs.readFileSync(templatePath, "utf-8");
    // The marker is what lets the workflow find and replace the prior
    // ShipFlow comment instead of stacking duplicates on every push.
    assert.match(body, /<!-- shipflow-trace-marker -->/);
    // Both find-comment and create-or-update-comment actions are wired
    assert.match(body, /peter-evans\/find-comment@v3/);
    assert.match(body, /peter-evans\/create-or-update-comment@v4/);
    // The create step must use comment-id from find-comment's output
    assert.match(body, /comment-id:\s*\$\{\{\s*steps\.existing\.outputs\.comment-id/);
  });
});
