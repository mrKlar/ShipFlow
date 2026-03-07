# Block 1: Harden the UI vertical — Tasks

## 1.1 Add `fill` step

Allow text input in forms.

- Add `fill` to the Zod union in `lib/schema/ui-check.zod.js`
  - Schema: `{ fill: { testid: string, value: string } }` or `{ fill: { role: string, name: string, value: string } }`
- Add `fill` branch in `genPlaywrightSpec()` in `lib/gen.js`
  - Output: `await page.getByTestId("x").fill("value")` or `await page.getByRole("textbox", { name: "x" }).fill("value")`
- Test with a sample `vp/ui/` fixture

## 1.2 Add `select` step

Allow dropdown selection.

- Add `select` to the Zod union in `ui-check.zod.js`
  - Schema: `{ select: { testid: string, value: string } }` or by label
- Add `select` branch in `genPlaywrightSpec()`
  - Output: `await page.getByTestId("x").selectOption("value")`
- Test with a sample fixture

## 1.3 Add `hover` step

Allow hover interactions (menus, tooltips).

- Add `hover` to the Zod union in `ui-check.zod.js`
  - Schema: `{ hover: { role: string, name: string } }` (same locator logic as `click`)
- Add `hover` branch in `genPlaywrightSpec()`
  - Output: `await page.getByRole("button", { name: "x" }).hover()`
- Reuse `locatorExpr()` helper

## 1.4 Add `visible` / `hidden` assertions

Check element visibility.

- Add `visible` and `hidden` to the assert Zod union in `ui-check.zod.js`
  - Schema: `{ visible: { testid: string } }`, `{ hidden: { testid: string } }`
- Add branches in `assertExpr()` in `lib/gen.js`
  - Output: `await expect(page.getByTestId("x")).toBeVisible()`
  - Output: `await expect(page.getByTestId("x")).toBeHidden()`

## 1.5 Add `url_matches` assertion

Verify current URL after navigation.

- Add `url_matches` to the assert Zod union
  - Schema: `{ url_matches: { regex: string } }`
- Add branch in `assertExpr()`
  - Output: `await expect(page).toHaveURL(new RegExp("pattern"))`

## 1.6 Add `count` assertion

Verify number of matching elements.

- Add `count` to the assert Zod union
  - Schema: `{ count: { testid: string, equals: number } }` or `{ count: { role: string, name: string, equals: number } }`
- Add branch in `assertExpr()`
  - Output: `await expect(page.getByTestId("x")).toHaveCount(3)`

## 1.7 Support named fixtures (login reuse)

Allow a check to declare a `setup` referencing another check or a reusable fixture, so login flows are not duplicated.

- Define fixture format: `vp/ui/_fixtures/*.yml` with an `id` and a `flow` (no asserts)
- Add optional `setup: fixture-id` field to `UiCheck` schema
- In `genPlaywrightSpec()`, emit a `test.beforeEach` block that replays the fixture flow
- Generate fixture helpers as shared modules in `.gen/playwright/fixtures/`

## 1.8 Better schema validation errors

Current behavior: Zod throws a raw error on invalid YAML. Hard to debug.

- Catch `ZodError` in `readUiChecks()` in `lib/gen.js`
- Format issues with file name, path in the schema, expected type, received value
- Print one clear line per issue, e.g.: `vp/ui/login.yml: flow[2].click.name — expected string, got undefined`

## 1.9 Refactor locator strategy

Currently `click` uses `getByRole`. Other steps will need locators too (`fill`, `hover`, `select`). Extract a shared locator resolution function.

- Create `locatorFromStep(step)` that handles: `role` + `name`, `testid`, `label`
- Use it in `click`, `fill`, `hover`, `select` codegen
- Update Zod schemas to accept a common locator shape (union of `{ role, name }` | `{ testid }` | `{ label }`)
