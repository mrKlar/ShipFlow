# ShipFlow

This project uses ShipFlow for verification-first development.

## Two Phases

### Phase 1: Verification (human + AI)

Draft verifications in `vp/` — YAML files describing what the app must do.

Seven verification types:
- `vp/ui/*.yml` — UI checks (browser interactions + assertions)
- `vp/behavior/*.yml` — behavior checks (Given/When/Then scenarios)
- `vp/api/*.yml` — API checks (HTTP requests + response assertions)
- `vp/db/*.yml` — Database checks (SQL queries + row/cell assertions)
- `vp/nfr/*.yml` — Performance checks (load/performance thresholds)
- `vp/security/*.yml` — Security checks (auth/authz/headers/exposure)
- `vp/technical/*.yml` — Technical checks (frameworks/architecture/CI/infra/tooling)
- `vp/ui/_fixtures/*.yml` — reusable setup flows (login, etc.)

You MAY modify `vp/` files during this phase only.

### Phase 2: Implementation (AI-led, pack-controlled)

Implement app code that passes all generated tests. Treat the reviewed verification pack as ground truth; if it is wrong or ambiguous, stop and ask for pack changes.

## Normal Flow

```
1. Draft verifications collaboratively in `vp/`
2. Prefer `shipflow implement` for the normal implementation loop
3. Use granular commands only when debugging or inspecting the pipeline
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

For technical checks: ensure the repository structure, manifests, workflows, architecture boundaries, and declared tooling/services match the assertions.

## Commands

```bash
shipflow draft "<user request>"  # Standard flow: co-draft and refine the verification pack
shipflow implement      # Standard flow: validate, generate, implement, verify
shipflow map            # Advanced: review repo surfaces and coverage gaps
shipflow doctor         # Advanced: check local tools, runners, and adapters
shipflow lint           # Advanced: lint verification quality
shipflow gen            # Advanced: generate runnable tests from the pack
shipflow verify         # Advanced: run generated tests and write evidence
shipflow implement-once # Advanced: single implementation pass, no retry loop
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
