import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MOVIE_COMMENTS_LIVE_REQUIRED_VP_PATHS,
  buildMovieCommentsLiveArgs,
  buildMovieCommentsLiveEnv,
  movieCommentsLiveBaseUrl,
  movieCommentsLiveProviderCommand,
  normalizeMovieCommentsLiveProviders,
  resolveMovieCommentsLiveProviders,
  rewriteMovieCommentsBaseUrls,
  withMovieCommentsLivePortInDevScript,
} from "../support/movie-comments-live.js";

describe("movie-comments live support", () => {
  it("keeps a minimal movie-comments VP set that spans each required verification kind", () => {
    const kinds = new Set(MOVIE_COMMENTS_LIVE_REQUIRED_VP_PATHS.map(item => item.split("/")[1]));
    assert.deepEqual([...kinds].sort(), ["api", "behavior", "db", "domain", "technical", "ui"]);
    assert.equal(MOVIE_COMMENTS_LIVE_REQUIRED_VP_PATHS.includes("vp/technical/framework-stack.yml"), true);
    assert.equal(MOVIE_COMMENTS_LIVE_REQUIRED_VP_PATHS.includes("vp/ui/post-movie-comment.yml"), true);
    assert.equal(MOVIE_COMMENTS_LIVE_REQUIRED_VP_PATHS.includes("vp/ui/show-persisted-comment.yml"), true);
    assert.equal(MOVIE_COMMENTS_LIVE_REQUIRED_VP_PATHS.includes("vp/behavior/persist-movie-comments-after-restart.yml"), true);
    assert.equal(MOVIE_COMMENTS_LIVE_REQUIRED_VP_PATHS.includes("vp/api/get-movie-detail.yml"), true);
  });

  it("normalizes and de-duplicates requested providers", () => {
    assert.deepEqual(
      normalizeMovieCommentsLiveProviders("codex, claude, codex,kiro"),
      ["codex", "claude", "kiro"],
    );
  });

  it("resolves the correct command for kiro", () => {
    const exists = cmd => cmd === "kiro-cli";
    assert.equal(movieCommentsLiveProviderCommand("kiro", exists), "kiro-cli");
    assert.equal(movieCommentsLiveProviderCommand("claude", exists), null);
  });

  it("filters providers to installed CLIs", () => {
    const providers = resolveMovieCommentsLiveProviders({
      env: { SHIPFLOW_LIVE_MOVIE_COMMENTS_PROVIDERS: "codex,claude,gemini,kiro" },
      exists: cmd => cmd === "codex" || cmd === "kiro-cli",
    });
    assert.deepEqual(providers, ["codex", "kiro"]);
  });

  it("builds runner args from environment toggles", () => {
    const args = buildMovieCommentsLiveArgs("codex", {
      SHIPFLOW_LIVE_KEEP: "1",
      SHIPFLOW_LIVE_MODEL: "gpt-5-codex",
    });
    assert.ok(args.some(value => value.endsWith("examples/movie-comments-app/run-live.mjs")));
    assert.ok(args.includes("--provider=codex"));
    assert.ok(args.includes("--keep"));
    assert.ok(args.includes("--model=gpt-5-codex"));
  });

  it("does not force SHIPFLOW_LIVE_MAX_ITERATIONS unless explicitly overridden", () => {
    const inherited = buildMovieCommentsLiveEnv({ PATH: "/usr/bin" }, "/tmp/node");
    assert.equal(Object.hasOwn(inherited, "SHIPFLOW_LIVE_MAX_ITERATIONS"), false);
    assert.match(inherited.PATH, /^\/tmp:/);

    const overridden = buildMovieCommentsLiveEnv({
      PATH: "/usr/bin",
      SHIPFLOW_LIVE_MAX_ITERATIONS: "7",
    }, "/tmp/node");
    assert.equal(overridden.SHIPFLOW_LIVE_MAX_ITERATIONS, "7");
  });

  it("builds isolated dev/runtime settings for parallel live runs", () => {
    assert.equal(movieCommentsLiveBaseUrl(4312), "http://127.0.0.1:4312");
    assert.equal(withMovieCommentsLivePortInDevScript("node src/server.js", 4312), "PORT=4312 node src/server.js");
    assert.equal(
      rewriteMovieCommentsBaseUrls("base_url: http://localhost:3000\nother: http://127.0.0.1:3000\n", 4312),
      "base_url: http://127.0.0.1:4312\nother: http://127.0.0.1:4312\n",
    );
  });
});
