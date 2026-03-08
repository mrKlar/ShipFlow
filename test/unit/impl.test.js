import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFiles, buildPrompt } from "../../lib/impl.js";

describe("parseFiles", () => {
  it("parses single file", () => {
    const text = `Some intro text.

--- FILE: src/server.js ---
console.log("hello");
--- END FILE ---

Done.`;
    const files = parseFiles(text);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, "src/server.js");
    assert.equal(files[0].content, 'console.log("hello");\n');
  });

  it("parses multiple files", () => {
    const text = `--- FILE: src/server.js ---
const a = 1;
--- END FILE ---

--- FILE: src/public/index.html ---
<html></html>
--- END FILE ---`;
    const files = parseFiles(text);
    assert.equal(files.length, 2);
    assert.equal(files[0].path, "src/server.js");
    assert.equal(files[1].path, "src/public/index.html");
  });

  it("preserves multiline content", () => {
    const text = `--- FILE: src/app.js ---
line1
line2
line3
--- END FILE ---`;
    const files = parseFiles(text);
    assert.equal(files[0].content, "line1\nline2\nline3\n");
  });

  it("returns empty array for no files", () => {
    assert.deepEqual(parseFiles("no files here"), []);
  });

  it("handles file with empty content", () => {
    const text = `--- FILE: src/.gitkeep ---
--- END FILE ---`;
    const files = parseFiles(text);
    assert.equal(files.length, 1);
    assert.equal(files[0].content, "");
  });
});

describe("buildPrompt", () => {
  const vpFiles = [{ path: "vp/ui/test.yml", content: "id: test\n" }];
  const genFiles = [{ path: ".gen/playwright/test.test.ts", content: "test('x', ...)" }];
  const config = { impl: { srcDir: "src", context: "Node.js app" } };

  it("includes VP verifications", () => {
    const p = buildPrompt(vpFiles, [], [], config, null);
    assert.ok(p.includes("vp/ui/test.yml"));
    assert.ok(p.includes("id: test"));
  });

  it("includes generated tests", () => {
    const p = buildPrompt(vpFiles, genFiles, [], config, null);
    assert.ok(p.includes(".gen/playwright/test.test.ts"));
    assert.ok(p.includes("test('x', ...)"));
  });

  it("includes project context", () => {
    const p = buildPrompt(vpFiles, [], [], config, null);
    assert.ok(p.includes("Node.js app"));
  });

  it("includes current source code", () => {
    const srcFiles = [{ path: "src/server.js", content: "const x = 1;" }];
    const p = buildPrompt(vpFiles, [], srcFiles, config, null);
    assert.ok(p.includes("src/server.js"));
    assert.ok(p.includes("const x = 1;"));
  });

  it("includes errors on retry", () => {
    const p = buildPrompt(vpFiles, [], [], config, "Error: element not found");
    assert.ok(p.includes("Test Failures"));
    assert.ok(p.includes("Error: element not found"));
  });

  it("truncates long errors to 8000 chars", () => {
    const longError = "x".repeat(10000);
    const p = buildPrompt(vpFiles, [], [], config, longError);
    assert.ok(p.includes("x".repeat(8000)));
    assert.ok(!p.includes("x".repeat(9000)));
  });

  it("includes output format instructions", () => {
    const p = buildPrompt(vpFiles, [], [], config, null);
    assert.ok(p.includes("--- FILE: src/"));
    assert.ok(p.includes("--- END FILE ---"));
  });

  it("uses default srcDir if not configured", () => {
    const p = buildPrompt(vpFiles, [], [], {}, null);
    assert.ok(p.includes('"src/"'));
  });
});
