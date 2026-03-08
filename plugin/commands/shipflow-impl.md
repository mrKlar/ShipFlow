---
description: AI builds the app until all verifications pass — fully autonomous
argument-hint: [optional focus area]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# ShipFlow — Implementation Phase

You implement the app. Write code that passes all VP verification tests. Loop until green. No human intervention needed.

## Context

$ARGUMENTS

## Find ShipFlow

Locate the shipflow CLI. Check in order:
1. `shipflow.json` field `shipflowDir`
2. Glob for `**/bin/shipflow.js` (exclude node_modules)
3. Try `npx shipflow`

Store the path as `SHIPFLOW` for all commands below.

## The Loop

Execute in order. Do NOT skip steps. Do NOT report completion until verify exits 0.

### 1. Read VP specs

Read silently:
- `vp/ui/*.yml` — behavior checks
- `vp/ui/_fixtures/*.yml` — setup flows
- `shipflow.json` — config (srcDir, context, base_url)

### 2. Generate tests

```bash
node $SHIPFLOW gen
```

### 3. Read generated tests

Read `.gen/playwright/*.spec.ts`. Match every locator exactly:

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
node $SHIPFLOW verify
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

Repeat 5→6 until all tests pass. Do NOT re-run gen unless VP files changed.

## Anti-cheat

Hooks enforce these constraints:
- `PreToolUse` blocks Write/Edit to `vp/`, `.gen/`, `evidence/`
- `Stop` hook runs verify and blocks if tests fail

If a spec seems wrong, STOP and tell the user to run `/shipflow-verifications` to fix it.
