# ShipFlow — Todo App

This project uses ShipFlow. You are the implementer. Follow this workflow exactly.

## Two phases, two roles

### Phase 1: Spec (human + AI collaboration)
**Model: Claude Opus 4.6** (`claude-opus-4-6`)

The human and AI collaborate to define Verification Pack specs in `vp/`.
- Discuss requirements, edge cases, expected behaviors
- Write `vp/ui/*.yml` checks (what the app must do)
- Write `vp/ui/_fixtures/*.yml` (reusable setup flows like login)
- Review and refine until the human approves the specs

You MAY modify `vp/` files during this phase only.

### Phase 2: Implementation (AI autonomous)
**Model: Claude Sonnet 4.6** (`claude-sonnet-4-6`)

You implement the app code that satisfies the VP specs. The human does not write code.

## The implementation loop

```
1. Read VP       →  Read all vp/ui/*.yml and vp/ui/_fixtures/*.yml
2. Generate      →  Run: node ../../bin/shipflow.js gen
3. Read tests    →  Read .gen/playwright/*.spec.ts
4. Implement     →  Write app code under src/
5. Verify        →  Run: node ../../bin/shipflow.js verify
6. Pass?         →  If exit 0: DONE. If not: read errors, fix code, goto 5.
```

Do NOT skip any step. Do NOT report completion until verify exits 0.

## Protected paths — NEVER modify during implementation

- `vp/**`, `.gen/**`, `evidence/**`
- `shipflow.json`, `playwright.config.ts`

## Project context

- Node.js HTTP server using only built-in modules (http, fs, path, url)
- HTML pages with inline CSS and JavaScript
- No frameworks, no npm runtime dependencies
- Todo list app with login page

## What to get right

| VP concept | Your HTML |
|---|---|
| `testid: foo` | `data-testid="foo"` |
| `label: Email` | `<label for="x">Email</label>` + `<input id="x">` |
| `click: { name: Submit }` | `<button>Submit</button>` |
| `visible/hidden` | Element present, visibility controlled by CSS |
| `count: { testid: x, equals: 3 }` | Exactly 3 elements with `data-testid="x"` |
| `url_matches` | URL after navigation matches regex |

## Commands

```bash
node ../../bin/shipflow.js gen       # VP → tests
node ../../bin/shipflow.js verify    # Run tests
```
