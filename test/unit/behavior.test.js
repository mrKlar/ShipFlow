import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BehaviorCheck } from "../../lib/schema/behavior-check.zod.js";
import { genBehaviorTest, genBehaviorFeature, genBehaviorSteps, genBehaviorCucumberArtifacts, isGherkinBehavior } from "../../lib/gen-behavior.js";

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

  it("accepts tags and examples for scenario outlines", () => {
    const r = BehaviorCheck.parse({
      ...base,
      runner: { kind: "gherkin", framework: "cucumber" },
      tags: ["smoke", "checkout"],
      given: [{ open: "/checkout/<region>" }],
      when: [{ click: { testid: "continue-<region>" } }],
      then: [{ url_matches: { regex: "/checkout/<region>/payment" } }],
      examples: [{ region: "eu" }, { region: "us" }],
    });
    assert.equal(r.tags.length, 2);
    assert.equal(r.examples.length, 2);
    assert.equal(r.runner.framework, "cucumber");
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
    assert.ok(code.includes('[mutation guard]'));
    assert.ok(code.includes("mutationGuardPasses"));
    assert.ok(code.includes('=== "5"'));
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

  it("expands examples into multiple concrete tests", () => {
    const code = genBehaviorTest({
      ...check,
      tags: ["smoke"],
      scenario: "Checkout in <region>",
      given: [{ open: "/checkout/<region>" }],
      when: [{ click: { testid: "continue-<region>" } }],
      then: [{ url_matches: { regex: "/checkout/<region>/payment" } }],
      examples: [{ region: "eu" }, { region: "us" }],
    });
    assert.ok(code.includes('test("test-bdd[1]: Checkout in eu"'));
    assert.ok(code.includes('test("test-bdd[2]: Checkout in us"'));
    assert.ok(code.includes('goto("http://localhost:3000/checkout/eu")'));
    assert.ok(code.includes('continue-eu'));
    assert.ok(code.includes('// tags: smoke'));
  });

  it("detects gherkin/cucumber behavior checks", () => {
    assert.equal(isGherkinBehavior({ runner: { kind: "gherkin" } }), true);
    assert.equal(isGherkinBehavior({ runner: { framework: "cucumber" } }), true);
    assert.equal(isGherkinBehavior({ runner: { kind: "playwright" } }), false);
  });

  it("generates a Gherkin feature file", () => {
    const code = genBehaviorFeature({
      ...check,
      runner: { kind: "gherkin", framework: "cucumber" },
      tags: ["smoke"],
      scenario: "Checkout in <region>",
      given: [{ open: "/checkout/<region>" }],
      when: [{ click: { testid: "continue-<region>" } }],
      then: [{ url_matches: { regex: "/checkout/<region>/payment" } }],
      examples: [{ region: "eu" }],
    });
    assert.ok(code.includes("Feature: Calculator"));
    assert.ok(code.includes("@smoke"));
    assert.ok(code.includes("Scenario: test-bdd[1]: Checkout in eu"));
    assert.ok(code.includes("Given ShipFlow given step 1"));
    assert.ok(code.includes("When ShipFlow when step 1"));
    assert.ok(code.includes("Then ShipFlow assert 1"));
    assert.ok(code.includes("[mutation guard]"));
  });

  it("generates Cucumber step definitions", () => {
    const code = genBehaviorSteps({
      ...check,
      runner: { kind: "gherkin", framework: "cucumber" },
    });
    assert.ok(code.includes('@cucumber/cucumber'));
    assert.ok(code.includes('chromium'));
    assert.ok(code.includes('ShipFlow setup step'));
    assert.ok(code.includes('ShipFlow when step'));
    assert.ok(code.includes('ShipFlow mutation guard'));
  });

  it("generates paired Cucumber artifacts", () => {
    const artifacts = genBehaviorCucumberArtifacts({
      ...check,
      __file: "vp/behavior/adding.yml",
      runner: { kind: "gherkin", framework: "cucumber" },
    });
    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[0].kind, "cucumber-feature");
    assert.equal(artifacts[1].kind, "cucumber-steps");
    assert.ok(artifacts[0].name.endsWith(".feature"));
    assert.ok(artifacts[1].name.endsWith(".steps.mjs"));
  });
});
