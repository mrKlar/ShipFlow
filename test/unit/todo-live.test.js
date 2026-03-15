import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TODO_LIVE_MINIMAL_VP_PATHS,
  buildTodoLiveArgs,
  buildTodoLiveEnv,
  normalizeTodoLiveProviders,
  resolveTodoLiveProviders,
  rewriteTodoLiveBaseUrls,
  todoLiveBaseUrl,
  todoLiveProviderCommand,
  withTodoLivePortInDevScript,
} from "../support/todo-live.js";

describe("todo live support", () => {
  it("keeps a minimal todo VP set that spans each core verification kind", () => {
    const kinds = new Set(TODO_LIVE_MINIMAL_VP_PATHS.map(item => item.split("/")[1]));
    assert.deepEqual([...kinds].sort(), ["api", "behavior", "db", "technical", "ui"]);
    assert.equal(TODO_LIVE_MINIMAL_VP_PATHS.includes("vp/api/patch-todo-completed.yml"), true);
    assert.equal(TODO_LIVE_MINIMAL_VP_PATHS.includes("vp/behavior/persist-todos-after-restart.yml"), true);
    assert.equal(TODO_LIVE_MINIMAL_VP_PATHS.includes("vp/ui/add-todo.yml"), false);
    assert.equal(TODO_LIVE_MINIMAL_VP_PATHS.includes("vp/ui/complete-todo.yml"), false);
  });

  it("normalizes and de-duplicates requested providers", () => {
    assert.deepEqual(
      normalizeTodoLiveProviders("codex, claude, codex,kiro"),
      ["codex", "claude", "kiro"],
    );
  });

  it("resolves the correct command for kiro", () => {
    const exists = cmd => cmd === "kiro-cli";
    assert.equal(todoLiveProviderCommand("kiro", exists), "kiro-cli");
    assert.equal(todoLiveProviderCommand("claude", exists), null);
  });

  it("filters providers to installed CLIs", () => {
    const providers = resolveTodoLiveProviders({
      env: { SHIPFLOW_LIVE_TODO_PROVIDERS: "codex,claude,gemini,kiro" },
      exists: cmd => cmd === "codex" || cmd === "kiro-cli",
    });
    assert.deepEqual(providers, ["codex", "kiro"]);
  });

  it("builds runner args from environment toggles", () => {
    const args = buildTodoLiveArgs("codex", {
      SHIPFLOW_LIVE_KEEP: "1",
      SHIPFLOW_LIVE_AI_DRAFT: "1",
      SHIPFLOW_LIVE_MODEL: "gpt-5-codex",
    });
    assert.ok(args.some(value => value.endsWith("examples/todo-app/run-claude-live.mjs")));
    assert.ok(args.includes("--provider=codex"));
    assert.ok(args.includes("--keep"));
    assert.ok(args.includes("--ai-draft"));
    assert.ok(args.includes("--model=gpt-5-codex"));
  });

  it("does not force SHIPFLOW_LIVE_MAX_ITERATIONS unless explicitly overridden", () => {
    const inherited = buildTodoLiveEnv({ PATH: "/usr/bin" }, "/tmp/node");
    assert.equal(Object.hasOwn(inherited, "SHIPFLOW_LIVE_MAX_ITERATIONS"), false);
    assert.match(inherited.PATH, /^\/tmp:/);

    const overridden = buildTodoLiveEnv({
      PATH: "/usr/bin",
      SHIPFLOW_LIVE_MAX_ITERATIONS: "7",
    }, "/tmp/node");
    assert.equal(overridden.SHIPFLOW_LIVE_MAX_ITERATIONS, "7");
  });

  it("builds isolated dev/runtime settings for parallel live runs", () => {
    assert.equal(todoLiveBaseUrl(4312), "http://127.0.0.1:4312");
    assert.equal(withTodoLivePortInDevScript("node src/server.js", 4312), "PORT=4312 node src/server.js");
    assert.equal(
      rewriteTodoLiveBaseUrls("base_url: http://localhost:3000\nother: http://127.0.0.1:3000\n", 4312),
      "base_url: http://127.0.0.1:4312\nother: http://127.0.0.1:4312\n",
    );
  });
});
