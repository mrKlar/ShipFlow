import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createImplementationLogger,
  implementationLogPaths,
  sanitizeImplementationActorId,
} from "../../lib/implementation-logs.js";

function readJsonLines(file) {
  return fs.readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

describe("sanitizeImplementationActorId", () => {
  it("normalizes actor ids for file-safe log names", () => {
    assert.equal(sanitizeImplementationActorId("Strategy Lead"), "strategy-lead");
    assert.equal(sanitizeImplementationActorId("UI/Specialist"), "ui-specialist");
    assert.equal(sanitizeImplementationActorId(""), "unknown");
  });
});

describe("createImplementationLogger", () => {
  it("writes a global event stream and per-actor streams with sequential steps", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-impl-logs-"));
    try {
      const logger = createImplementationLogger({
        cwd: tmpDir,
        provider: "codex",
        model: "gpt-5-codex",
      });
      logger.log({
        actorType: "orchestrator",
        actorId: "orchestrator",
        event: "run.started",
        message: "Implementation run started.",
        stage: "starting",
      });
      logger.log({
        actorType: "specialist",
        actorId: "ui",
        event: "specialist.completed",
        message: "UI specialist wrote 1 file.",
        iteration: 1,
        stage: "impl",
        data: {
          written_files: ["src/app.js"],
        },
      });

      const paths = implementationLogPaths(tmpDir);
      const events = readJsonLines(paths.events);
      assert.equal(events.length, 2);
      assert.deepEqual(events.map(event => event.step), [1, 2]);
      assert.equal(events[0].run_id, events[1].run_id);
      assert.equal(events[1].actor_id, "ui");

      const orchestratorEvents = readJsonLines(path.join(paths.actorsDir, "orchestrator.jsonl"));
      const uiEvents = readJsonLines(path.join(paths.actorsDir, "ui.jsonl"));
      assert.equal(orchestratorEvents.length, 1);
      assert.equal(uiEvents.length, 1);
      assert.equal(uiEvents[0].event, "specialist.completed");

      const manifest = JSON.parse(fs.readFileSync(paths.manifest, "utf-8"));
      assert.equal(manifest.last_step, 2);
      assert.equal(manifest.event_count, 2);
      assert.deepEqual(manifest.actors.map(actor => actor.actor_id), ["orchestrator", "ui"]);
      assert.equal(manifest.files.events, "evidence/implement-log.jsonl");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
