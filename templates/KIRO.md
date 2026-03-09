# ShipFlow

This project uses ShipFlow for verification-first shipping with Kiro.

## Two Phases

### Phase 1: Verification Pack Definition

Draft verifications in `vp/`. Use natural-language discussion when helpful, or finalize proposals directly when the user wants an autonomous draft.
Use `shipflow draft` to propose, refine, accept or reject candidates, then write the selected verifications into `vp/`.
During drafting, first summarize what ShipFlow understood, then walk through UI, behavior, API, database, performance, security, and technical using ShipFlow's per-type discussion prompts and best practices, ask clarifications when the draft marks a decision unresolved, and do not abandon the workflow just because proposals came from local drafting rather than extra AI refinement.

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

Implement app code that passes all generated checks. Treat the verification pack as ground truth; if it is wrong or ambiguous, stop and ask for pack changes.

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
- you help finalize the pack when needed
- once the pack is finalized, run `shipflow implement`

Do NOT report completion until `shipflow verify` exits 0.

Before `shipflow implement`, run `shipflow status --json`. Only continue when `implementation_gate.ready === true`.

## Protected Paths

Never modify these during implementation:
- `vp/**`
- `.gen/**`
- `evidence/**`
- `.shipflow/**`
- `shipflow.json`

If a verification seems wrong, stop and go back to the verification phase with the user.

## What to Match

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

Only use `--update-existing` with explicit approval before replacing an existing verification file.
