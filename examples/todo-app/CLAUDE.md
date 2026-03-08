# ShipFlow — Todo App

This project uses ShipFlow for verification-first development.

## Verifications

- `vp/ui/*.yml` — UI checks (browser)
- `vp/ui/_fixtures/*.yml` — reusable setup flows (login)

## Implementation Loop

```
1. Read VP       →  Read all vp/**/*.yml
2. Generate      →  Run: shipflow gen
3. Read tests    →  Read .gen/playwright/*.test.ts
4. Implement     →  Write app code under src/
5. Verify        →  Run: shipflow verify
6. Pass?         →  If exit 0: DONE. If not: read errors, fix code, goto 5.
```

## Protected Paths — NEVER Modify During Implementation

`vp/`, `.gen/`, `evidence/`, `shipflow.json`, `playwright.config.ts`

## Project Context

- Node.js HTTP server, built-in modules only (http, fs, path, url)
- HTML pages with inline CSS and JavaScript
- No frameworks, no npm runtime dependencies
- Todo list app with login page

## What to Match

| VP concept | Your code |
|---|---|
| `testid: foo` | `data-testid="foo"` |
| `label: Email` | `<label>Email</label>` + associated input |
| `click: { name: Submit }` | `<button>Submit</button>` |
| `visible/hidden` | Element in DOM, visibility via CSS |
| `count: { testid: x, equals: 3 }` | Exactly 3 elements with that testid |

## Commands

```bash
shipflow gen       # VP → tests
shipflow verify    # Run tests
```
