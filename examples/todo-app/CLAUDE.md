# ShipFlow — Todo App

This project uses ShipFlow for verification-first development.

## Verifications

- `vp/ui/*.yml` — UI checks (browser)
- `vp/ui/_fixtures/*.yml` — reusable setup flows (login)

## Normal Flow

```
1. Draft verifications collaboratively
2. Prefer `shipflow implement` for the normal loop
3. Use `shipflow gen` and `shipflow verify` only when debugging
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
shipflow implement # doctor → lint → gen → implement → verify
shipflow gen       # Advanced: VP → tests
shipflow verify    # Advanced: run tests only
```
