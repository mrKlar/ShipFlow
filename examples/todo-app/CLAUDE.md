# ShipFlow

This project uses ShipFlow for verification-first shipping.

## Two Phases

### Phase 1: Verification (human + AI)

Draft verifications in `vp/` — YAML files describing what the app must do.
Use `shipflow draft` as a proposal review workflow: inspect candidate checks, accept or reject them, then write accepted proposals into `vp/`.

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

Implement app code that passes all generated checks. Treat the reviewed verification pack as ground truth; if it is wrong or ambiguous, stop and ask for pack changes.

## Normal Flow

```
1. Draft verifications collaboratively in `vp/`
2. Prefer `shipflow implement` for the normal implementation loop
3. Use granular commands only when debugging or inspecting the pipeline
```

Do NOT skip any step. Do NOT report completion until `shipflow verify` exits 0.

Before `shipflow implement`, run `shipflow status --json`. Only continue when there is no `draft_session`, or `draft_session.ready_for_implement === true`.

## Protected Paths — NEVER Modify During Implementation

- `vp/**` — Verification pack (source of truth)
- `.gen/**` — Generated tests
- `evidence/**` — Verification output
- `.shipflow/**` — Draft session state
- `shipflow.json` — Framework config

If a verification seems wrong, STOP. Go back to Phase 1 with the human.

## What to Match in Your Implementation

For UI checks, and behavior checks compiled to Playwright web flows, these locators apply:

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

For technical checks: ensure the repository structure, manifests, workflows, architecture boundaries, and declared tooling/services match the assertions. Choose `runner.kind` / `runner.framework` deliberately and prefer backend-native technical rules over smoke commands.

## Commands

```bash
shipflow draft "<user request>"  # Standard flow: co-draft and refine the verification pack
shipflow draft --clear-session
shipflow draft --accept=vp/path.yml
shipflow draft --reject=vp/path.yml
shipflow draft --accept=vp/path.yml --write
shipflow draft --accept=vp/path.yml --update-existing --write
shipflow implement      # Standard flow: validate, generate, implement, verify
shipflow map "<user request>"  # Advanced: review repo surfaces and coverage gaps
shipflow doctor         # Advanced: check local tools, runners, and adapters
shipflow lint           # Advanced: lint verification quality
shipflow gen            # Advanced: generate runnable tests from the pack
shipflow verify         # Advanced: run generated tests and write evidence
shipflow implement-once # Advanced: single implementation pass, no retry loop
```

Only use `--update-existing` when the human explicitly approved replacing an existing verification file.

## On Verify Failure

For Playwright-backed UI checks, common fixes:
- **Element not found** → missing `data-testid`, wrong label/button text
- **Text mismatch** → wrong textContent in your HTML/JS
- **Timeout** → element never appears; check rendering
- **Count mismatch** → wrong number of elements
- **URL mismatch** → navigation doesn't produce expected URL
- **Status mismatch** → API returns wrong HTTP status
- **JSON mismatch** → API response body doesn't match assertions

Fix the code, run `shipflow verify` again. Repeat until green.
