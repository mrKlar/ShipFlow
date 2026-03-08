import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BehaviorCheck } from "../../lib/schema/behavior-check.zod.js";
import { genBehaviorTest } from "../../lib/gen-behavior.js";

const base = {
  id: "test-bdd",
  feature: "Calculator",
  scenario: "Adding two numbers",
  severity: "blocker",
  app: { kind: "web", base_url: "http://localhost:3000" },
};

describe("BehaviorCheck schema", () => {
  it("accepts valid behavior check", () => {
    const r = BehaviorCheck.parse({
      ...base,
      given: [{ open: "/calc" }],
      when: [{ click: { testid: "btn-add" } }],
      then: [{ text_equals: { testid: "display", equals: "5" } }],
    });
    assert.equal(r.id, "test-bdd");
    assert.equal(r.feature, "Calculator");
    assert.equal(r.scenario, "Adding two numbers");
  });

  it("accepts optional setup", () => {
    const r = BehaviorCheck.parse({
      ...base,
      setup: "login",
      given: [],
      when: [],
      then: [],
    });
    assert.equal(r.setup, "login");
  });

  it("given/when use FlowStep, then uses Assert", () => {
    const r = BehaviorCheck.parse({
      ...base,
      given: [
        { open: "/page" },
        { fill: { testid: "input", value: "hello" } },
      ],
      when: [
        { click: { name: "Submit" } },
        { wait_for: { ms: 300 } },
      ],
      then: [
        { visible: { testid: "result" } },
        { url_matches: { regex: "/success" } },
      ],
    });
    assert.equal(r.given.length, 2);
    assert.equal(r.when.length, 2);
    assert.equal(r.then.length, 2);
  });

  it("rejects missing feature field", () => {
    assert.throws(() => {
      BehaviorCheck.parse({
        id: "x", scenario: "y", severity: "blocker",
        app: { kind: "web", base_url: "http://localhost:3000" },
        given: [], when: [], then: [],
      });
    });
  });

  it("rejects extra fields", () => {
    assert.throws(() => {
      BehaviorCheck.parse({ ...base, given: [], when: [], then: [], extra: true });
    });
  });
});

describe("genBehaviorTest", () => {
  const check = {
    ...base,
    given: [{ open: "/calc" }],
    when: [{ click: { role: "button", name: "Add" } }],
    then: [{ text_equals: { testid: "display", equals: "5" } }],
  };

  it("generates test.describe with feature name", () => {
    const code = genBehaviorTest(check);
    assert.ok(code.includes('test.describe("Calculator"'));
  });

  it("generates test with id and scenario", () => {
    const code = genBehaviorTest(check);
    assert.ok(code.includes('"test-bdd: Adding two numbers"'));
  });

  it("generates Given/When/Then comments", () => {
    const code = genBehaviorTest(check);
    assert.ok(code.includes("// Given"));
    assert.ok(code.includes("// When"));
    assert.ok(code.includes("// Then"));
  });

  it("generates flow steps and assertions", () => {
    const code = genBehaviorTest(check);
    assert.ok(code.includes('goto("http://localhost:3000/calc")'));
    assert.ok(code.includes('.click()'));
    assert.ok(code.includes('toHaveText("5")'));
  });

  it("inlines setup fixture", () => {
    const withSetup = { ...check, setup: "auth" };
    const fixturesMap = new Map([
      ["auth", {
        id: "auth",
        app: { kind: "web", base_url: "http://localhost:3000" },
        flow: [{ open: "/login" }, { fill: { testid: "email", value: "a@b.com" } }],
      }],
    ]);
    const code = genBehaviorTest(withSetup, fixturesMap);
    assert.ok(code.includes("// setup: auth"));
    assert.ok(code.includes('goto("http://localhost:3000/login")'));
  });

  it("throws on unknown fixture", () => {
    const withSetup = { ...check, setup: "missing" };
    assert.throws(() => genBehaviorTest(withSetup, new Map()), /Unknown fixture "missing"/);
  });
});
