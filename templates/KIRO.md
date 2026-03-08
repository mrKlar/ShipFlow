# ShipFlow

This project uses ShipFlow for verification-first development with Kiro.

## Two Phases

### Phase 1: Verification (human + AI)

Draft verifications in `vp/` together with the user. Use natural language collaboration to refine coverage before writing or updating files.

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

## Kiro Flow

Use the low-friction flow first:

```text
1. Collaborate with the user on the verification pack
2. Prefer `shipflow draft "<user request>"` when starter proposals would help
3. Prefer `shipflow implement` for the standard implementation loop
4. Use granular commands only for debugging or inspection
```

Typical handoff:
- user asks to draft or refine ShipFlow verifications
- you help review and tighten the pack
- once the pack is reviewed, run `shipflow implement`

Do NOT report completion until `shipflow verify` exits 0.

## Protected Paths

Never modify these during implementation:
- `vp/**`
- `.gen/**`
- `evidence/**`
- `shipflow.json`
- `playwright.config.ts`

If a verification seems wrong, stop and go back to the verification phase with the user.

## What to Match

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
shipflow map "<user request>"  # Advanced: review repo surfaces and coverage gaps
shipflow doctor         # Advanced: check local tools, runners, and adapters
shipflow lint           # Advanced: lint verification quality
shipflow gen            # Advanced: generate runnable tests from the pack
shipflow verify         # Advanced: run generated tests and write evidence
shipflow implement-once # Advanced: single implementation pass, no retry loop
```
