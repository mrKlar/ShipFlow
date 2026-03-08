---
name: shipflow-impl
description: Implement an app until all ShipFlow verifications pass — fully autonomous. Use when the user wants to build, implement, or fix code to pass VP tests. Do NOT use for writing verifications — use $shipflow-verifications instead.
---

# ShipFlow — Implementation Phase

You implement the app. Write code that passes all VP verification tests. Loop until green. No human intervention needed.

## Context

$ARGUMENTS

## Setup

If the project has no `shipflow.json`, run `shipflow init --codex` first.

Ensure Playwright is installed:
```bash
npm ls @playwright/test 2>/dev/null || npm install -D @playwright/test && npx playwright install
```

## The Loop

Execute in order. Do NOT skip steps. Do NOT report completion until verify exits 0.

### 1. Read VP verifications

Read silently:
- `vp/ui/*.yml`, `vp/behavior/*.yml`, `vp/api/*.yml`, `vp/db/*.yml`
- `vp/ui/_fixtures/*.yml` — setup flows
- `shipflow.json` — config (srcDir, context, base_url)

### 2. Generate tests

```bash
shipflow gen
```

### 3. Read generated tests

Read `.gen/playwright/*.test.ts`. Match every locator exactly:

| In the test | Your HTML must have |
|---|---|
| `getByTestId("x")` | `data-testid="x"` |
| `getByLabel("X")` | `<label>X</label>` + associated input |
| `getByRole("button", { name: "X" })` | `<button>X</button>` |
| `toBeVisible()` | Element rendered and visible |
| `toBeHidden()` | Element in DOM but hidden via CSS |
| `toHaveCount(n)` | Exactly n elements with that selector |
| `toHaveText("x")` | Element textContent equals "x" |
| `toHaveURL(/pattern/)` | URL matches regex after navigation |

### 4. Implement

Write app code under the configured `srcDir` (default: `src/`). Read `shipflow.json` `impl.context` for tech stack.

**NEVER modify**: `vp/`, `.gen/`, `evidence/`, `shipflow.json`, `playwright.config.ts`

### 5. Verify

```bash
shipflow verify
```

### 6. Result

- **Exit 0** — Done. Report files written and test count.
- **Exit non-zero** — Read errors, fix code, go back to step 5.

Common fixes:

| Error | Fix |
|---|---|
| Element not found | Missing `data-testid`, wrong label/button text |
| Text mismatch | Wrong textContent in rendering |
| Timeout | Element never appears — check server/rendering |
| Count mismatch | Wrong number of elements rendered |
| URL mismatch | Navigation produces wrong URL |
| Status mismatch | API returns wrong HTTP status |
| JSON mismatch | API response body doesn't match assertions |

Repeat 5 → 6 until all tests pass. Do NOT re-run gen unless VP files changed.

## Anti-cheat

The only way to pass is by writing code that actually works. Protected paths (`vp/`, `.gen/`, `evidence/`) are enforced by sandbox rules.

If a verification seems wrong, STOP and tell the user to use `$shipflow-verifications` to fix it.
