import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { locatorExpr, genStep, assertExpr, genPlaywrightTest } from "../../lib/gen.js";
import { genDomainArtifacts } from "../../lib/gen-domain.js";

describe("locatorExpr", () => {
  it("generates getByTestId", () => {
    assert.equal(locatorExpr({ testid: "btn" }), 'page.getByTestId("btn")');
  });

  it("generates getByLabel", () => {
    assert.equal(locatorExpr({ label: "Email" }), 'page.getByLabel("Email")');
  });

  it("generates getByRole", () => {
    assert.equal(
      locatorExpr({ role: "button", name: "Submit" }),
      'page.getByRole("button", { name: "Submit" })',
    );
  });

  it("generates getByRole with regex", () => {
    assert.equal(
      locatorExpr({ role: "link", name: "Home.*", name_regex: true }),
      'page.getByRole("link", { name: new RegExp("Home.*") })',
    );
  });

  it("ignores extra fields like value", () => {
    assert.equal(
      locatorExpr({ testid: "input", value: "ignored" }),
      'page.getByTestId("input")',
    );
  });
});

describe("genStep", () => {
  const base = "http://localhost:3000";

  it("generates open", () => {
    assert.equal(genStep({ open: "/login" }, base), 'await page.goto("http://localhost:3000/login");');
  });

  it("generates click", () => {
    assert.equal(
      genStep({ click: { role: "button", name: "Go" } }, base),
      'await page.getByRole("button", { name: "Go" }).click();',
    );
  });

  it("generates click by testid", () => {
    assert.equal(
      genStep({ click: { testid: "submit-btn" } }, base),
      'await page.getByTestId("submit-btn").click();',
    );
  });

  it("generates fill", () => {
    assert.equal(
      genStep({ fill: { testid: "email", value: "a@b.com" } }, base),
      'await page.getByTestId("email").fill("a@b.com");',
    );
  });

  it("generates fill by label", () => {
    assert.equal(
      genStep({ fill: { label: "Password", value: "secret" } }, base),
      'await page.getByLabel("Password").fill("secret");',
    );
  });

  it("generates fill by role", () => {
    assert.equal(
      genStep({ fill: { role: "textbox", name: "Email", value: "a@b.com" } }, base),
      'await page.getByRole("textbox", { name: "Email" }).fill("a@b.com");',
    );
  });

  it("generates select", () => {
    assert.equal(
      genStep({ select: { label: "Country", value: "FR" } }, base),
      'await page.getByLabel("Country").selectOption("FR");',
    );
  });

  it("generates select by testid", () => {
    assert.equal(
      genStep({ select: { testid: "lang", value: "en" } }, base),
      'await page.getByTestId("lang").selectOption("en");',
    );
  });

  it("generates hover", () => {
    assert.equal(
      genStep({ hover: { testid: "trigger" } }, base),
      'await page.getByTestId("trigger").hover();',
    );
  });

  it("generates hover by role", () => {
    assert.equal(
      genStep({ hover: { role: "button", name: "Menu" } }, base),
      'await page.getByRole("button", { name: "Menu" }).hover();',
    );
  });

  it("generates wait_for with ms", () => {
    assert.equal(genStep({ wait_for: { ms: 500 } }, base), "await page.waitForTimeout(500);");
  });

  it("generates wait_for with default ms", () => {
    assert.equal(genStep({ wait_for: {} }, base), "await page.waitForTimeout(250);");
  });

  it("generates route_block", () => {
    assert.equal(
      genStep({ route_block: { path: "/api/calculate", status: 500 } }, base),
      'await page.route("**/api/calculate", route => route.fulfill({ status: 500, body: "" }));',
    );
  });

  it("throws on unknown step", () => {
    assert.throws(() => genStep({ unknown: true }, base), /Unknown step/);
  });
});

describe("assertExpr", () => {
  it("generates text_equals", () => {
    assert.equal(
      assertExpr({ text_equals: { testid: "msg", equals: "hello" } }),
      'await expect(page.getByTestId("msg")).toHaveText("hello");',
    );
  });

  it("generates text_matches", () => {
    assert.equal(
      assertExpr({ text_matches: { testid: "msg", regex: "he.*" } }),
      'await expect(page.getByTestId("msg")).toHaveText(new RegExp("he.*"));',
    );
  });

  it("generates visible", () => {
    assert.equal(
      assertExpr({ visible: { testid: "avatar" } }),
      'await expect(page.getByTestId("avatar")).toBeVisible();',
    );
  });

  it("generates hidden", () => {
    assert.equal(
      assertExpr({ hidden: { testid: "empty" } }),
      'await expect(page.getByTestId("empty")).toBeHidden();',
    );
  });

  it("generates url_matches", () => {
    assert.equal(
      assertExpr({ url_matches: { regex: "/dash.*" } }),
      'await expect(page).toHaveURL(new RegExp("/dash.*"));',
    );
  });

  it("generates count", () => {
    assert.equal(
      assertExpr({ count: { testid: "card", equals: 3 } }),
      'await expect(page.getByTestId("card")).toHaveCount(3);',
    );
  });

  it("generates count zero", () => {
    assert.equal(
      assertExpr({ count: { testid: "card", equals: 0 } }),
      'await expect(page.getByTestId("card")).toHaveCount(0);',
    );
  });

  it("throws on unknown assert", () => {
    assert.throws(() => assertExpr({ unknown: {} }), /Unknown assert/);
  });
});

describe("genPlaywrightTest", () => {
  const check = {
    id: "test-1",
    title: "Basic test",
    severity: "blocker",
    app: { kind: "web", base_url: "http://localhost:3000" },
    flow: [
      { open: "/page" },
      { click: { role: "button", name: "Go" } },
    ],
    assert: [
      { text_equals: { testid: "result", equals: "OK" } },
    ],
  };

  it("generates valid Playwright test", () => {
    const code = genPlaywrightTest(check);
    assert.ok(code.includes('import { test, expect } from "@playwright/test"'));
    assert.ok(code.includes('"test-1: Basic test"'));
    assert.ok(code.includes('const shipflowBaseUrl = process.env.SHIPFLOW_BASE_URL || "http://localhost:3000";'));
    assert.ok(code.includes("await page.goto(shipflowBaseUrl);"));
    assert.ok(code.includes('[mutation guard]'));
    assert.ok(code.includes("mutationGuardPasses"));
    assert.ok(code.includes('evaluateAll(nodes => ((nodes[0]?.textContent ?? "")).trim())'));
    assert.ok(code.includes('=== "OK"'));
    assert.ok(code.includes('await page.goto(shipflowBaseUrl + "/page")'));
    assert.ok(code.includes('.click()'));
    assert.ok(code.includes('toHaveText("OK")'));
  });

  it("injects sqlite state reset into Playwright UI tests", () => {
    const code = genPlaywrightTest({
      ...check,
      state: {
        kind: "sqlite",
        connection: "./test.db",
        reset_sql: "DELETE FROM todos;",
      },
    });
    assert.ok(code.includes('import { DatabaseSync } from "node:sqlite"'));
    assert.ok(code.includes('resetShipFlowState({"kind":"sqlite","connection":"./test.db","reset_sql":"DELETE FROM todos;"})'));
  });

  it("inlines setup fixture flow", () => {
    const withSetup = { ...check, setup: "auth" };
    const fixturesMap = new Map([
      ["auth", {
        id: "auth",
        app: { kind: "web", base_url: "http://localhost:3000" },
        flow: [
          { open: "/login" },
          { fill: { testid: "email", value: "a@b.com" } },
        ],
      }],
    ]);
    const code = genPlaywrightTest(withSetup, fixturesMap);
    assert.ok(code.includes("// setup: auth"));
    assert.ok(code.includes('goto(shipflowBaseUrl + "/login")'));
    assert.ok(code.includes('.fill("a@b.com")'));
    // Setup steps appear before the check's own flow
    const setupIdx = code.indexOf("// setup: auth");
    const openIdx = code.indexOf('goto(shipflowBaseUrl + "/page")');
    assert.ok(setupIdx < openIdx);
  });

  it("throws on unknown fixture reference", () => {
    const withSetup = { ...check, setup: "missing" };
    assert.throws(
      () => genPlaywrightTest(withSetup, new Map()),
      /Unknown fixture "missing"/,
    );
  });

  it("works without fixturesMap when no setup", () => {
    const code = genPlaywrightTest(check);
    assert.ok(code.includes("test-1: Basic test"));
  });

  it("generates all assertion types", () => {
    const c = {
      ...check,
      flow: [],
      assert: [
        { text_equals: { testid: "a", equals: "v" } },
        { text_matches: { testid: "b", regex: "p" } },
        { visible: { testid: "c" } },
        { hidden: { testid: "d" } },
        { url_matches: { regex: "/x" } },
        { count: { testid: "e", equals: 2 } },
      ],
    };
    const code = genPlaywrightTest(c);
    assert.ok(code.includes("toHaveText("));
    assert.ok(code.includes("toBeVisible()"));
    assert.ok(code.includes("toBeHidden()"));
    assert.ok(code.includes("toHaveURL("));
    assert.ok(code.includes("toHaveCount(2)"));
  });

  it("generates visual helpers for visual UI checks", () => {
    const visualCheck = {
      id: "ui-cart-visual",
      title: "Cart visual contract",
      severity: "blocker",
      app: { kind: "web", base_url: "http://localhost:3000" },
      flow: [{ open: "/cart" }],
      targets: {
        summary: { testid: "cart-summary" },
        cta: { testid: "checkout-button" },
      },
      assert: [{ visible: { testid: "cart-summary" } }],
      visual: {
        context: {
          viewport: { width: 1440, height: 900 },
          color_scheme: "light",
          reduced_motion: true,
          wait_for_fonts: true,
        },
        assertions: [
          {
            css_equals: {
              target: "cta",
              property: "border-radius",
              equals: "12px",
            },
          },
        ],
        snapshots: [
          {
            name: "cart-summary.desktop.light",
            target: "summary",
            max_diff_ratio: 0.002,
            max_diff_pixels: 120,
            per_pixel_threshold: 0.1,
          },
        ],
      },
    };

    const code = genPlaywrightTest(visualCheck);
    assert.ok(code.includes('import { PNG } from "pngjs";'));
    assert.ok(code.includes('import pixelmatch from "pixelmatch";'));
    assert.ok(code.includes('test.use({'));
    assert.ok(code.includes('colorScheme: "light"'));
    assert.ok(code.includes('const projectRoot = path.resolve(__dirname, "..", "..");'));
    assert.ok(code.includes('path.join(projectRoot, "vp", "ui", "_baselines"'));
    assert.ok(code.includes('await runVisualChecks(page, "ui-cart-visual", visualTargets, '));
    assert.ok(code.includes('"cart-summary.desktop.light"'));
  });
});

describe("genDomainArtifacts", () => {
  it("generates a business-domain runner that validates data engineering contracts", () => {
    const [artifact] = genDomainArtifacts({
      __file: "vp/domain/todo.yml",
      id: "domain-todo",
      title: "Todo business object stays explicit",
      severity: "blocker",
      object: { name: "Todo", kind: "entity" },
      identity: { fields: ["id"], strategy: "surrogate" },
      attributes: [
        { name: "id", type: "number", required: true, mutable: false },
        { name: "title", type: "string", required: true, mutable: true },
        { name: "status", type: "string", required: true, mutable: true },
      ],
      references: [],
      invariants: ["Todo title must be non-empty."],
      access_patterns: {
        reads: [{ name: "list_todos", fields: ["id", "title", "status"] }],
        writes: [{ name: "create_todo", fields: ["title"] }],
      },
      data_engineering: {
        storage: {
          canonical_model: "todo",
          allow_denormalized_copies: true,
          write_models: [{ name: "todo_record", fields: ["id", "title", "status"] }],
          read_models: [{ name: "todo_list_item", fields: ["id", "title", "status"] }],
        },
        exchange: {
          inbound: [{ name: "create_todo_command", fields: ["title"] }],
          outbound: [{ name: "todo_response", fields: ["id", "title", "status"] }],
        },
        guidance: ["Do not force a one-to-one mapping."],
      },
      assert: [
        { data_engineering_present: { sections: ["storage", "exchange"] } },
        { read_model_defined: { name: "todo_list_item" } },
      ],
    });

    assert.equal(artifact.kind, "domain-runner");
    assert.ok(artifact.content.includes("ShipFlow business-domain backend"));
    assert.ok(artifact.content.includes("data engineering section"));
    assert.ok(artifact.content.includes("todo_list_item"));
  });
});
