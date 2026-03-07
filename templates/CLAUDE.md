# ShipFlow

This project uses ShipFlow. You are the implementer. Follow this workflow exactly.

## Two phases, two roles

### Phase 1: Spec (human + AI collaboration)
**Model: Claude Opus 4.6** (`claude-opus-4-6`)

The human and AI collaborate to define Verification Pack specs in `vp/`.
- Discuss requirements, edge cases, expected behaviors
- Write `vp/ui/*.yml` checks (what the app must do)
- Write `vp/ui/_fixtures/*.yml` (reusable setup flows like login)
- Review and refine until the human approves the specs

You MAY modify `vp/` files during this phase. This is the only phase where VP modification is allowed.

### Phase 2: Implementation (AI autonomous)
**Model: Claude Sonnet 4.6** (`claude-sonnet-4-6`)

You implement the app code that satisfies the VP specs. The human does not write code. You do.

## The implementation loop

Every time you implement or modify the app, follow this exact loop:

```
1. Read VP       →  Read all vp/ui/*.yml and vp/ui/_fixtures/*.yml
2. Generate      →  Run: shipflow gen
3. Read tests    →  Read .gen/playwright/*.spec.ts
4. Implement     →  Write app code under src/
5. Verify        →  Run: shipflow verify
6. Pass?         →  If exit 0: DONE. If not: read errors, fix code, goto 5.
```

Do NOT skip any step. Do NOT report completion until `shipflow verify` exits 0.

## Protected paths — NEVER modify during implementation

- `vp/**` — Verification Pack (specs are the source of truth)
- `.gen/**` — Generated tests (compiled from VP by `shipflow gen`)
- `evidence/**` — Verification output (written by `shipflow verify`)
- `shipflow.json` — Framework config
- `playwright.config.ts` — Test runner config

If you need to change a spec to fix a test, STOP. That means the spec is wrong. Go back to Phase 1 with the human.

## What to read in VP specs

Each `vp/ui/*.yml` file defines one check with:
- `flow`: user actions (open, click, fill, select, hover, wait_for)
- `assert`: expected outcomes (text_equals, text_matches, visible, hidden, url_matches, count)
- `setup`: optional reference to a fixture for reusable setup (e.g. login)

## What to get right in your implementation

The generated Playwright tests use these locators. Match them exactly:

| VP concept | Your HTML must have |
|---|---|
| `testid: foo` | `data-testid="foo"` attribute |
| `label: Email` | `<label for="x">Email</label>` + `<input id="x">` |
| `click: { name: Submit }` | `<button>Submit</button>` (or element with matching accessible name) |
| `role: link, name: Home` | `<a>Home</a>` (or element with matching role + name) |
| `url_matches: { regex: "/dashboard" }` | URL after navigation matches the regex |
| `visible: { testid: x }` | Element with `data-testid="x"` is visible |
| `hidden: { testid: x }` | Element with `data-testid="x"` exists but is hidden (`display:none` etc.) |
| `count: { testid: x, equals: 3 }` | Exactly 3 elements with `data-testid="x"` |

## Commands

```bash
shipflow gen      # Compile vp/ → .gen/playwright/*.spec.ts + vp.lock.json
shipflow verify   # Run Playwright tests → evidence/run.json, exit 0 if all pass
```

## On verify failure

Read the Playwright error output carefully. Common fixes:
- **Element not found** → missing `data-testid`, wrong label text, or wrong button text
- **Text mismatch** → wrong `textContent` in your HTML/JS
- **Timeout** → element never appears; check your rendering logic
- **Count mismatch** → wrong number of elements; check your filtering/rendering
- **URL mismatch** → your navigation doesn't produce the expected URL

Fix the code, then run `shipflow verify` again. Repeat until green.
