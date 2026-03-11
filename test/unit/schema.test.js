import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UiCheck, UiFixture } from "../../lib/schema/ui-check.zod.js";
import { DomainCheck } from "../../lib/schema/domain-check.zod.js";

const base = {
  id: "test-1",
  title: "Test",
  severity: "blocker",
  app: { kind: "web", base_url: "http://localhost:3000" },
};

describe("UiCheck schema — flow steps", () => {
  it("accepts open step", () => {
    const r = UiCheck.parse({ ...base, flow: [{ open: "/page" }], assert: [] });
    assert.equal(r.flow[0].open, "/page");
  });

  it("accepts click by name (role defaults to button)", () => {
    const r = UiCheck.parse({ ...base, flow: [{ click: { name: "Submit" } }], assert: [] });
    assert.equal(r.flow[0].click.role, "button");
    assert.equal(r.flow[0].click.name, "Submit");
  });

  it("accepts click with explicit role", () => {
    const r = UiCheck.parse({ ...base, flow: [{ click: { role: "link", name: "Home" } }], assert: [] });
    assert.equal(r.flow[0].click.role, "link");
  });

  it("accepts click by testid", () => {
    const r = UiCheck.parse({ ...base, flow: [{ click: { testid: "btn" } }], assert: [] });
    assert.equal(r.flow[0].click.testid, "btn");
  });

  it("accepts click by label", () => {
    const r = UiCheck.parse({ ...base, flow: [{ click: { label: "Submit" } }], assert: [] });
    assert.equal(r.flow[0].click.label, "Submit");
  });

  it("accepts click with name_regex", () => {
    const r = UiCheck.parse({ ...base, flow: [{ click: { name: "Submit.*", name_regex: true } }], assert: [] });
    assert.equal(r.flow[0].click.name_regex, true);
  });

  it("accepts fill by testid with value", () => {
    const r = UiCheck.parse({ ...base, flow: [{ fill: { testid: "email", value: "a@b.com" } }], assert: [] });
    assert.equal(r.flow[0].fill.testid, "email");
    assert.equal(r.flow[0].fill.value, "a@b.com");
  });

  it("accepts fill by label with value", () => {
    const r = UiCheck.parse({ ...base, flow: [{ fill: { label: "Email", value: "a@b.com" } }], assert: [] });
    assert.equal(r.flow[0].fill.label, "Email");
  });

  it("accepts fill by role with value", () => {
    const r = UiCheck.parse({ ...base, flow: [{ fill: { role: "textbox", name: "Email", value: "a@b.com" } }], assert: [] });
    assert.equal(r.flow[0].fill.role, "textbox");
  });

  it("rejects fill without value", () => {
    assert.throws(() => {
      UiCheck.parse({ ...base, flow: [{ fill: { testid: "x" } }], assert: [] });
    });
  });

  it("accepts select by testid", () => {
    const r = UiCheck.parse({ ...base, flow: [{ select: { testid: "dropdown", value: "opt1" } }], assert: [] });
    assert.equal(r.flow[0].select.value, "opt1");
  });

  it("accepts select by label", () => {
    const r = UiCheck.parse({ ...base, flow: [{ select: { label: "Country", value: "FR" } }], assert: [] });
    assert.equal(r.flow[0].select.label, "Country");
  });

  it("accepts select by role", () => {
    const r = UiCheck.parse({ ...base, flow: [{ select: { role: "combobox", name: "Country", value: "FR" } }], assert: [] });
    assert.equal(r.flow[0].select.role, "combobox");
  });

  it("accepts hover by role", () => {
    const r = UiCheck.parse({ ...base, flow: [{ hover: { role: "button", name: "Menu" } }], assert: [] });
    assert.equal(r.flow[0].hover.role, "button");
  });

  it("accepts hover by testid", () => {
    const r = UiCheck.parse({ ...base, flow: [{ hover: { testid: "trigger" } }], assert: [] });
    assert.equal(r.flow[0].hover.testid, "trigger");
  });

  it("accepts hover by label", () => {
    const r = UiCheck.parse({ ...base, flow: [{ hover: { label: "Info" } }], assert: [] });
    assert.equal(r.flow[0].hover.label, "Info");
  });

  it("hover requires explicit role (no default)", () => {
    assert.throws(() => {
      UiCheck.parse({ ...base, flow: [{ hover: { name: "Menu" } }], assert: [] });
    });
  });

  it("accepts wait_for with ms", () => {
    const r = UiCheck.parse({ ...base, flow: [{ wait_for: { ms: 500 } }], assert: [] });
    assert.equal(r.flow[0].wait_for.ms, 500);
  });

  it("accepts wait_for without ms", () => {
    const r = UiCheck.parse({ ...base, flow: [{ wait_for: {} }], assert: [] });
    assert.equal(r.flow[0].wait_for.ms, undefined);
  });

  it("accepts route_block with path and status", () => {
    const r = UiCheck.parse({ ...base, flow: [{ route_block: { path: "/api/calc", status: 500 } }], assert: [] });
    assert.equal(r.flow[0].route_block.path, "/api/calc");
    assert.equal(r.flow[0].route_block.status, 500);
  });

  it("route_block defaults status to 500", () => {
    const r = UiCheck.parse({ ...base, flow: [{ route_block: { path: "/api/calc" } }], assert: [] });
    assert.equal(r.flow[0].route_block.status, 500);
  });

  it("rejects unknown step", () => {
    assert.throws(() => {
      UiCheck.parse({ ...base, flow: [{ unknown: "x" }], assert: [] });
    });
  });

  it("rejects click with mixed locators", () => {
    assert.throws(() => {
      UiCheck.parse({ ...base, flow: [{ click: { name: "X", testid: "Y" } }], assert: [] });
    });
  });
});

describe("UiCheck schema — assertions", () => {
  it("accepts text_equals", () => {
    const r = UiCheck.parse({ ...base, flow: [], assert: [{ text_equals: { testid: "x", equals: "hello" } }] });
    assert.equal(r.assert[0].text_equals.equals, "hello");
  });

  it("accepts text_matches", () => {
    const r = UiCheck.parse({ ...base, flow: [], assert: [{ text_matches: { testid: "x", regex: "he.*" } }] });
    assert.equal(r.assert[0].text_matches.regex, "he.*");
  });

  it("accepts visible", () => {
    const r = UiCheck.parse({ ...base, flow: [], assert: [{ visible: { testid: "x" } }] });
    assert.equal(r.assert[0].visible.testid, "x");
  });

  it("accepts hidden", () => {
    const r = UiCheck.parse({ ...base, flow: [], assert: [{ hidden: { testid: "x" } }] });
    assert.equal(r.assert[0].hidden.testid, "x");
  });

  it("accepts url_matches", () => {
    const r = UiCheck.parse({ ...base, flow: [], assert: [{ url_matches: { regex: "/dash.*" } }] });
    assert.equal(r.assert[0].url_matches.regex, "/dash.*");
  });

  it("accepts count", () => {
    const r = UiCheck.parse({ ...base, flow: [], assert: [{ count: { testid: "card", equals: 5 } }] });
    assert.equal(r.assert[0].count.equals, 5);
  });

  it("accepts count with zero", () => {
    const r = UiCheck.parse({ ...base, flow: [], assert: [{ count: { testid: "card", equals: 0 } }] });
    assert.equal(r.assert[0].count.equals, 0);
  });

  it("rejects count with negative number", () => {
    assert.throws(() => {
      UiCheck.parse({ ...base, flow: [], assert: [{ count: { testid: "card", equals: -1 } }] });
    });
  });

  it("rejects unknown assertion", () => {
    assert.throws(() => {
      UiCheck.parse({ ...base, flow: [], assert: [{ unknown: { testid: "x" } }] });
    });
  });
});

describe("UiCheck schema — setup field", () => {
  it("accepts optional setup", () => {
    const r = UiCheck.parse({ ...base, setup: "login-fixture", flow: [], assert: [] });
    assert.equal(r.setup, "login-fixture");
  });

  it("works without setup", () => {
    const r = UiCheck.parse({ ...base, flow: [], assert: [] });
    assert.equal(r.setup, undefined);
  });
});

describe("UiCheck schema — top-level validation", () => {
  it("rejects missing id", () => {
    assert.throws(() => {
      UiCheck.parse({ title: "T", severity: "blocker", app: { kind: "web", base_url: "x" }, flow: [], assert: [] });
    });
  });

  it("rejects invalid severity", () => {
    assert.throws(() => {
      UiCheck.parse({ ...base, severity: "low", flow: [], assert: [] });
    });
  });

  it("rejects extra top-level fields", () => {
    assert.throws(() => {
      UiCheck.parse({ ...base, flow: [], assert: [], extra: true });
    });
  });
});

describe("UiCheck schema — visual checks", () => {
  it("accepts strict visual checks with named targets", () => {
    const result = UiCheck.parse({
      ...base,
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
            per_pixel_threshold: 0.1,
          },
        ],
      },
    });

    assert.equal(result.visual.snapshots[0].target, "summary");
    assert.equal(result.targets.summary.testid, "cart-summary");
  });

  it("rejects visual checks without named targets", () => {
    assert.throws(() => {
      UiCheck.parse({
        ...base,
        flow: [{ open: "/" }],
        assert: [],
        visual: {
          context: {
            viewport: { width: 1280, height: 720 },
            reduced_motion: true,
            wait_for_fonts: true,
          },
          snapshots: [
            {
              name: "home.desktop",
              full_page: true,
              max_diff_ratio: 0,
              per_pixel_threshold: 0.1,
            },
          ],
        },
      });
    }, /visual checks require named targets/);
  });

  it("rejects element snapshots without a target", () => {
    assert.throws(() => {
      UiCheck.parse({
        ...base,
        flow: [{ open: "/" }],
        targets: { summary: { testid: "summary" } },
        assert: [],
        visual: {
          context: {
            viewport: { width: 1280, height: 720 },
            reduced_motion: true,
            wait_for_fonts: true,
          },
          snapshots: [
            {
              name: "summary.desktop",
              max_diff_ratio: 0,
              per_pixel_threshold: 0.1,
            },
          ],
        },
      });
    }, /snapshot requires target unless full_page is true/);
  });

  it("accepts full-page snapshots without a target", () => {
    const result = UiCheck.parse({
      ...base,
      flow: [{ open: "/" }],
      targets: { page_shell: { testid: "shell" } },
      assert: [],
      visual: {
        context: {
          viewport: { width: 1280, height: 720 },
          reduced_motion: true,
          wait_for_fonts: true,
        },
        snapshots: [
          {
            name: "home.desktop",
            full_page: true,
            max_diff_ratio: 0,
            per_pixel_threshold: 0.1,
          },
        ],
      },
    });

    assert.equal(result.visual.snapshots[0].full_page, true);
  });
});

describe("UiFixture schema", () => {
  const fb = { id: "fixture-1", app: { kind: "web", base_url: "http://localhost:3000" } };

  it("accepts valid fixture", () => {
    const r = UiFixture.parse({ ...fb, flow: [{ open: "/login" }] });
    assert.equal(r.id, "fixture-1");
  });

  it("accepts optional title", () => {
    const r = UiFixture.parse({ ...fb, title: "Setup", flow: [] });
    assert.equal(r.title, "Setup");
  });

  it("rejects fixture with assert field", () => {
    assert.throws(() => {
      UiFixture.parse({ ...fb, flow: [], assert: [] });
    });
  });

  it("accepts all step types in fixture flow", () => {
    const r = UiFixture.parse({
      ...fb,
      flow: [
        { open: "/login" },
        { fill: { testid: "email", value: "a@b.com" } },
        { click: { name: "Go" } },
        { select: { label: "Role", value: "admin" } },
        { hover: { testid: "info" } },
        { wait_for: { ms: 100 } },
      ],
    });
    assert.equal(r.flow.length, 6);
  });
});

describe("DomainCheck schema", () => {
  const baseDomain = {
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
      guidance: ["Split business objects from technical read/write/exchange models."],
    },
    assert: [
      { data_engineering_present: { sections: ["storage", "exchange"] } },
      { read_model_defined: { name: "todo_list_item" } },
    ],
  };

  it("accepts business-domain checks with explicit data engineering", () => {
    const result = DomainCheck.parse(baseDomain);
    assert.equal(result.data_engineering.storage.canonical_model, "todo");
    assert.equal(result.assert[0].data_engineering_present.sections[0], "storage");
  });

  it("rejects checks that omit data engineering", () => {
    assert.throws(() => {
      const invalid = { ...baseDomain };
      delete invalid.data_engineering;
      DomainCheck.parse(invalid);
    });
  });
});
