import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { locatorExpr, genStep, assertExpr, genPlaywrightSpec } from "../../lib/gen.js";

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

describe("genPlaywrightSpec", () => {
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

  it("generates valid Playwright spec", () => {
    const spec = genPlaywrightSpec(check);
    assert.ok(spec.includes('import { test, expect } from "@playwright/test"'));
    assert.ok(spec.includes('"test-1: Basic test"'));
    assert.ok(spec.includes('await page.goto("http://localhost:3000")'));
    assert.ok(spec.includes('await page.goto("http://localhost:3000/page")'));
    assert.ok(spec.includes('.click()'));
    assert.ok(spec.includes('toHaveText("OK")'));
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
    const spec = genPlaywrightSpec(withSetup, fixturesMap);
    assert.ok(spec.includes("// setup: auth"));
    assert.ok(spec.includes('goto("http://localhost:3000/login")'));
    assert.ok(spec.includes('.fill("a@b.com")'));
    // Setup steps appear before the check's own flow
    const setupIdx = spec.indexOf("// setup: auth");
    const openIdx = spec.indexOf('goto("http://localhost:3000/page")');
    assert.ok(setupIdx < openIdx);
  });

  it("throws on unknown fixture reference", () => {
    const withSetup = { ...check, setup: "missing" };
    assert.throws(
      () => genPlaywrightSpec(withSetup, new Map()),
      /Unknown fixture "missing"/,
    );
  });

  it("works without fixturesMap when no setup", () => {
    const spec = genPlaywrightSpec(check);
    assert.ok(spec.includes("test-1: Basic test"));
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
    const spec = genPlaywrightSpec(c);
    assert.ok(spec.includes("toHaveText("));
    assert.ok(spec.includes("toBeVisible()"));
    assert.ok(spec.includes("toBeHidden()"));
    assert.ok(spec.includes("toHaveURL("));
    assert.ok(spec.includes("toHaveCount(2)"));
  });
});
