import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFlags, ensureArray, flagListAsArray, relPath } from "../../lib/util/cli.js";
import { slugify, timestampStamp } from "../../lib/util/id.js";

describe("util/cli", () => {
  it("parseFlags handles boolean, single-value, and repeated flags", () => {
    assert.deepEqual(parseFlags(["--ai", "--id=x", "--vp=a", "--vp=b"]), {
      ai: true,
      id: "x",
      vp: ["a", "b"],
    });
  });

  it("parseFlags ignores positional args", () => {
    assert.deepEqual(parseFlags(["new", "intent", "--id=x"]), { id: "x" });
  });

  it("ensureArray normalizes scalars and undefined", () => {
    assert.deepEqual(ensureArray(undefined), []);
    assert.deepEqual(ensureArray(null), []);
    assert.deepEqual(ensureArray("a"), ["a"]);
    assert.deepEqual(ensureArray(["a", "b"]), ["a", "b"]);
  });

  it("flagListAsArray splits comma values and trims, filters empties", () => {
    const flags = { vp: ["a, b", "c", "d, ,e"] };
    assert.deepEqual(flagListAsArray(flags, "vp"), ["a", "b", "c", "d", "e"]);
    assert.deepEqual(flagListAsArray({}, "vp"), []);
  });

  it("relPath returns POSIX-style relative paths", () => {
    const out = relPath("/tmp/repo", "/tmp/repo/sub/file.yml");
    assert.equal(out, "sub/file.yml");
  });
});

describe("util/id", () => {
  it("slugify lowercases, replaces non-alphanumerics, trims to 60 chars", () => {
    assert.equal(slugify("Hello World!"), "hello-world");
    assert.equal(slugify("---"), "item");
    assert.equal(slugify("---", "decision"), "decision");
    assert.equal(slugify(undefined), "item");
    assert.equal(slugify("a".repeat(80)).length, 60);
  });

  it("timestampStamp returns YYYY-MM-DD-HH-MM-SS-Z", () => {
    const out = timestampStamp(new Date("2026-05-07T14:30:00.000Z"));
    assert.equal(out, "2026-05-07-14-30-00Z");
  });
});
