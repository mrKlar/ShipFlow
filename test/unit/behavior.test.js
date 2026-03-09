import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BehaviorCheck } from "../../lib/schema/behavior-check.zod.js";
import {
  genBehaviorTest,
  genBehaviorFeature,
  genBehaviorSteps,
  genBehaviorCucumberArtifacts,
  isGherkinBehavior,
  resolveBehaviorExecutor,
} from "../../lib/gen-behavior.js";

const webBase = {
  id: "test-bdd",
  feature: "Calculator",
  scenario: "Adding two numbers",
  severity: "blocker",
  app: { kind: "web", base_url: "http://localhost:3000" },
};

describe("BehaviorCheck schema", () => {
  it("accepts valid web behavior checks", () => {
    const parsed = BehaviorCheck.parse({
      ...webBase,
      given: [{ open: "/calc" }],
      when: [{ click: { testid: "btn-add" } }],
      then: [{ text_equals: { testid: "display", equals: "5" } }],
    });
    assert.equal(parsed.app.kind, "web");
    assert.equal(parsed.feature, "Calculator");
  });

  it("accepts valid API behavior checks", () => {
    const parsed = BehaviorCheck.parse({
      id: "api-checkout",
      feature: "Checkout API",
      scenario: "Authenticated checkout succeeds",
      severity: "blocker",
      app: { kind: "api", base_url: "http://localhost:3000" },
      given: [],
      when: [{
        request: {
          method: "POST",
          path: "/api/checkout",
          body_json: { sku: "sku-1" },
        },
      }],
      then: [
        { status: 201 },
        { json_type: { path: "$", type: "object" } },
      ],
    });
    assert.equal(parsed.app.kind, "api");
    assert.equal(resolveBehaviorExecutor(parsed).framework, "playwright-request");
  });

  it("accepts valid TUI behavior checks", () => {
    const parsed = BehaviorCheck.parse({
      id: "cli-help",
      feature: "CLI",
      scenario: "Help command is available",
      severity: "blocker",
      app: { kind: "tui", command: "node", args: ["./src/cli.js"] },
      given: [],
      when: [{ stdin: { text: "--help\n" } }],
      then: [{ stdout_contains: "Usage" }],
    });
    assert.equal(parsed.app.kind, "tui");
    assert.equal(resolveBehaviorExecutor(parsed).kind, "pty");
  });

  it("accepts tags and examples for scenario outlines", () => {
    const parsed = BehaviorCheck.parse({
      ...webBase,
      runner: { kind: "gherkin", framework: "cucumber" },
      tags: ["smoke", "checkout"],
      given: [{ open: "/checkout/<region>" }],
      when: [{ click: { testid: "continue-<region>" } }],
      then: [{ url_matches: { regex: "/checkout/<region>/payment" } }],
      examples: [{ region: "eu" }, { region: "us" }],
    });
    assert.equal(parsed.tags.length, 2);
    assert.equal(parsed.examples.length, 2);
  });

  it("rejects executor/framework mismatches", () => {
    assert.throws(() => {
      BehaviorCheck.parse({
        ...webBase,
        executor: { kind: "api", framework: "playwright-request" },
        given: [{ open: "/calc" }],
        when: [],
        then: [{ url_matches: { regex: "/calc" } }],
      });
    }, /executor/);
  });
});

describe("genBehaviorTest", () => {
  it("generates web behavior tests with Given/When/Then comments", () => {
    const code = genBehaviorTest({
      ...webBase,
      given: [{ open: "/calc" }],
      when: [{ click: { role: "button", name: "Add" } }],
      then: [{ text_equals: { testid: "display", equals: "5" } }],
    });
    assert.ok(code.includes('test.describe("Calculator"'));
    assert.ok(code.includes("// Given"));
    assert.ok(code.includes("// When"));
    assert.ok(code.includes("// Then"));
    assert.ok(code.includes('[mutation guard]'));
    assert.ok(code.includes('goto("http://localhost:3000/calc")'));
  });

  it("inlines setup fixtures for web behavior checks", () => {
    const code = genBehaviorTest({
      ...webBase,
      setup: "auth",
      given: [{ open: "/calc" }],
      when: [{ click: { role: "button", name: "Add" } }],
      then: [{ text_equals: { testid: "display", equals: "5" } }],
    }, new Map([
      ["auth", {
        id: "auth",
        app: { kind: "web", base_url: "http://localhost:3000" },
        flow: [{ open: "/login" }, { fill: { testid: "email", value: "a@b.com" } }],
      }],
    ]));
    assert.ok(code.includes("// setup: auth"));
    assert.ok(code.includes('goto("http://localhost:3000/login")'));
  });

  it("generates API behavior tests with request execution helpers", () => {
    const code = genBehaviorTest({
      id: "api-checkout",
      feature: "Checkout API",
      scenario: "Authenticated checkout succeeds",
      severity: "blocker",
      app: { kind: "api", base_url: "http://localhost:3000" },
      given: [],
      when: [{
        request: {
          method: "POST",
          path: "/api/checkout",
          auth: { kind: "bearer", token: "test-token" },
          body_json: { sku: "sku-1" },
        },
      }],
      then: [
        { status: 201 },
        { json_type: { path: "$", type: "object" } },
      ],
    });
    assert.ok(code.includes("{ request }"));
    assert.ok(code.includes("sendBehaviorApiRequest"));
    assert.ok(code.includes("executeBehaviorApiSteps"));
    assert.ok(code.includes("res.status()"));
    assert.ok(code.includes("jsonType("));
    assert.ok(code.includes("[mutation guard]"));
    assert.ok(code.includes("mutatedVariants"));
    assert.ok(code.includes("toBeGreaterThan(0)"));
    assert.ok(!code.includes("const mutatedVariants = undefined;"));
  });

  it("includes schema helpers for API behavior json_schema assertions", () => {
    const code = genBehaviorTest({
      id: "api-list",
      feature: "Todo API",
      scenario: "Listing todos returns an array",
      severity: "blocker",
      app: { kind: "api", base_url: "http://localhost:3000" },
      given: [],
      when: [{ request: { method: "GET", path: "/api/todos" } }],
      then: [{ json_schema: { path: "$", schema: { type: "array" } } }],
    });
    assert.ok(code.includes("function assertJsonSchema"));
    assert.ok(code.includes("assertJsonSchema(jsonPath(body,"));
  });

  it("generates TUI behavior tests with a PTY-like harness", () => {
    const code = genBehaviorTest({
      id: "cli-help",
      feature: "CLI",
      scenario: "Help command is available",
      severity: "blocker",
      app: { kind: "tui", command: "node", args: ["./src/cli.js"] },
      given: [],
      when: [{ stdin: { text: "--help\n" } }],
      then: [{ stdout_contains: "Usage" }],
    });
    assert.ok(code.includes('import { spawn } from "node:child_process"'));
    assert.ok(code.includes("startShipFlowTui"));
    assert.ok(code.includes("stdout.includes"));
    assert.ok(code.includes("[mutation guard]"));
  });

  it("expands examples into multiple concrete web tests", () => {
    const code = genBehaviorTest({
      ...webBase,
      tags: ["smoke"],
      scenario: "Checkout in <region>",
      given: [{ open: "/checkout/<region>" }],
      when: [{ click: { testid: "continue-<region>" } }],
      then: [{ url_matches: { regex: "/checkout/<region>/payment" } }],
      examples: [{ region: "eu" }, { region: "us" }],
    });
    assert.ok(code.includes('test("test-bdd[1]: Checkout in eu"'));
    assert.ok(code.includes('test("test-bdd[2]: Checkout in us"'));
    assert.ok(code.includes('// tags: smoke'));
  });
});

describe("Gherkin/Cucumber behavior generation", () => {
  it("detects gherkin/cucumber behavior checks", () => {
    assert.equal(isGherkinBehavior({ runner: { kind: "gherkin" } }), true);
    assert.equal(isGherkinBehavior({ runner: { framework: "cucumber" } }), true);
    assert.equal(isGherkinBehavior({ runner: { kind: "playwright" } }), false);
  });

  it("generates a Gherkin feature file for API behavior", () => {
    const code = genBehaviorFeature({
      id: "api-checkout",
      feature: "Checkout API",
      scenario: "Authenticated checkout succeeds",
      severity: "blocker",
      runner: { kind: "gherkin", framework: "cucumber" },
      app: { kind: "api", base_url: "http://localhost:3000" },
      given: [],
      when: [{ request: { method: "POST", path: "/api/checkout", body_json: { sku: "sku-1" } } }],
      then: [{ status: 201 }],
    });
    assert.ok(code.includes("Feature: Checkout API"));
    assert.ok(code.includes("Scenario: api-checkout: Authenticated checkout succeeds"));
    assert.ok(code.includes("When ShipFlow when step 1"));
    assert.ok(code.includes("Then ShipFlow assert 1"));
    assert.ok(code.includes("[mutation guard]"));
  });

  it("generates Cucumber step definitions for API behavior", () => {
    const code = genBehaviorSteps({
      id: "api-checkout",
      feature: "Checkout API",
      scenario: "Authenticated checkout succeeds",
      severity: "blocker",
      runner: { kind: "gherkin", framework: "cucumber" },
      app: { kind: "api", base_url: "http://localhost:3000" },
      given: [],
      when: [{ request: { method: "POST", path: "/api/checkout", body_json: { sku: "sku-1" } } }],
      then: [{ status: 201 }],
    });
    assert.ok(code.includes('@cucumber/cucumber'));
    assert.ok(code.includes('request as playwrightRequest'));
    assert.ok(code.includes('runApiBehaviorStep'));
    assert.ok(code.includes('runBehaviorMutationGuard'));
  });

  it("generates Cucumber step definitions for TUI behavior", () => {
    const code = genBehaviorSteps({
      id: "cli-help",
      feature: "CLI",
      scenario: "Help command is available",
      severity: "blocker",
      runner: { kind: "gherkin", framework: "cucumber" },
      app: { kind: "tui", command: "node", args: ["./src/cli.js"] },
      given: [],
      when: [{ stdin: { text: "--help\n" } }],
      then: [{ stdout_contains: "Usage" }],
    });
    assert.ok(code.includes('import { spawn } from "node:child_process"'));
    assert.ok(code.includes('startShipFlowTui'));
    assert.ok(code.includes('runTuiBehaviorAssert'));
  });

  it("generates paired Cucumber artifacts", () => {
    const artifacts = genBehaviorCucumberArtifacts({
      ...webBase,
      __file: "vp/behavior/adding.yml",
      runner: { kind: "gherkin", framework: "cucumber" },
      given: [{ open: "/calc" }],
      when: [{ click: { testid: "btn-add" } }],
      then: [{ text_equals: { testid: "display", equals: "5" } }],
    });
    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[0].kind, "cucumber-feature");
    assert.equal(artifacts[1].kind, "cucumber-steps");
    assert.ok(artifacts[0].name.endsWith(".feature"));
    assert.ok(artifacts[1].name.endsWith(".steps.mjs"));
  });
});
