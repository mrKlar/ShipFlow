# ShipFlow

This project uses ShipFlow for verification-first development.

## Two Phases

### Phase 1: Verification (human + AI)

Draft verifications in `vp/` — YAML files describing what the app must do.

Five types of verifications:
- `vp/ui/*.yml` — UI checks (browser interactions + assertions)
- `vp/behavior/*.yml` — behavior checks (Given/When/Then scenarios)
- `vp/api/*.yml` — API checks (HTTP requests + response assertions)
- `vp/db/*.yml` — DB checks (SQL queries + row/cell assertions)
- `vp/nfr/*.yml` — NFR checks (load/performance thresholds)
- `vp/ui/_fixtures/*.yml` — reusable setup flows (login, etc.)

You MAY modify `vp/` files during this phase only.

### Phase 2: Implementation (AI autonomous)

Implement app code that passes all generated tests. The human does not write code.

## The Implementation Loop

```
1. Read VP       →  Read all vp/**/*.yml
2. Generate      →  Run: shipflow gen
3. Read tests    →  Read .gen/playwright/*.test.ts
4. Implement     →  Write app code under src/
5. Verify        →  Run: shipflow verify
6. Pass?         →  If exit 0: DONE. If not: read errors, fix code, goto 5.
```

Do NOT skip any step. Do NOT report completion until `shipflow verify` exits 0.

## Protected Paths — NEVER Modify During Implementation

- `vp/**` — Verification pack (source of truth)
- `.gen/**` — Generated tests
- `evidence/**` — Verification output
- `shipflow.json` — Framework config
- `playwright.config.ts` — Test runner config

If a verification seems wrong, STOP. Go back to Phase 1 with the human.

## What to Match in Your Implementation

The generated Playwright tests use these locators:

| VP concept | Your code must provide |
|---|---|
| `testid: foo` | `data-testid="foo"` attribute |
| `label: Email` | `<label>Email</label>` + associated input |
| `click: { name: Submit }` | `<button>Submit</button>` |
| `role: link, name: Home` | `<a>Home</a>` |
| `visible: { testid: x }` | Element visible in DOM |
| `hidden: { testid: x }` | Element in DOM but hidden |
| `count: { testid: x, equals: 3 }` | Exactly 3 elements with that testid |

For API checks: implement endpoints matching the `method`, `path`, response `status`, headers, and JSON body.

For DB checks: ensure the database schema and data match the `query` and assertions.

## Commands

```bash
shipflow gen      # Compile vp/ → .gen/playwright/*.test.ts + vp.lock.json
shipflow verify   # Run tests → evidence/run.json, exit 0 if all pass
```

## On Verify Failure

Read the Playwright error output. Common fixes:
- **Element not found** → missing `data-testid`, wrong label/button text
- **Text mismatch** → wrong textContent in your HTML/JS
- **Timeout** → element never appears; check rendering
- **Count mismatch** → wrong number of elements
- **URL mismatch** → navigation doesn't produce expected URL
- **Status mismatch** → API returns wrong HTTP status
- **JSON mismatch** → API response body doesn't match assertions

Fix the code, run `shipflow verify` again. Repeat until green.
