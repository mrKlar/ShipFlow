---
description: AI builds the app until all verifications pass — fully autonomous
argument-hint: [optional focus area]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# ShipFlow — Implementation Phase

Preferred command name: `/shipflow-implement`
Legacy alias: `/shipflow-impl`

You implement the app. Write code that passes all VP verification tests. Loop until green. No human intervention needed.

## Context

$ARGUMENTS

## Setup

Find the ShipFlow installation. Run:

```bash
SHIPFLOW_DIR="$(find ~/.claude/plugins/cache/shipflow -name 'shipflow.js' -path '*/bin/*' 2>/dev/null | head -1 | xargs dirname | xargs dirname)"
echo "ShipFlow: $SHIPFLOW_DIR"
```

Use `node $SHIPFLOW_DIR/bin/shipflow.js` for all shipflow commands.

If the project has no `.claude/hooks.json`, set up hooks:

```bash
cd "$(pwd)" && node "$SHIPFLOW_DIR/bin/shipflow.js" init
```

## The Loop

The normal path is a single command:

```bash
node $SHIPFLOW_DIR/bin/shipflow.js implement
```

That command automatically runs:
- doctor
- lint
- gen
- provider implementation
- verify
- retry until green or retry budget exhausted

Only drop to granular commands for debugging.

### 1. Read current verification context

Read `.gen/playwright/*.test.ts`. Match every locator and every HTTP/status/header/body expectation exactly:

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

### 2. Implement

Write app code under the configured `srcDir` (default: `src/`). Read `shipflow.json` `impl.context` for tech stack.

**NEVER modify**: `vp/`, `.gen/`, `evidence/`, `shipflow.json`, `playwright.config.ts`

For security checks, implement the exact rejection, header, and exposure behavior expected by the generated tests.
For technical checks, implement the exact repository constraints expected by the generated tests: framework choices, architecture rules, CI workflows, infrastructure files, and required tooling/services.

### 3. Verify

```bash
node $SHIPFLOW_DIR/bin/shipflow.js verify
```

### 4. Result

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

If a verification seems wrong, STOP and tell the user to run `/shipflow-verifications` to fix it.
