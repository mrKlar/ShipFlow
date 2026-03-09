# ShipFlow

This project uses ShipFlow for verification-first shipping with Gemini CLI.

## Two Phases

### Phase 1: Verification Pack Definition

Draft verifications in `vp/`. Use natural-language collaboration when helpful, or finalize proposals directly when the user wants automatic materialization.
Use `shipflow draft` to propose, refine, and finalize candidates into `vp/`.
Treat deterministic ShipFlow starters as foundational hints: base stack, protocol, architecture, delivery, or other universal constraints. Keep speculative product-level checks pending until the user clarifies them or explicitly delegates the choice.

Seven verification types:
- `vp/ui/*.yml` — UI checks
- `vp/behavior/*.yml` — behavior checks
- `vp/api/*.yml` — API checks
- `vp/db/*.yml` — database checks
- `vp/nfr/*.yml` — performance checks
- `vp/security/*.yml` — security checks
- `vp/technical/*.yml` — technical checks
- `vp/ui/_fixtures/*.yml` — reusable setup flows

You MAY modify `vp/` files during this phase only.

### Phase 2: Implementation (AI-led, pack-controlled)

Implement app code that passes the generated checks. Treat the verification pack as ground truth; if it is wrong or ambiguous, stop and ask for pack changes.

## Gemini Flow

Use the low-friction flow first:

```text
1. Collaborate on the verification pack
2. Prefer `shipflow draft "<user request>"` when starter proposals would help
3. Prefer `shipflow implement` for the standard implementation loop
4. Use granular commands only for debugging or inspection
```

Typical handoff:
- `/shipflow:draft` to draft or refine the pack
- finalize the pack with the user when needed
- `/shipflow:implement` once the pack is finalized

During drafting:
- summarize what ShipFlow understood before writing
- on an empty or low-signal greenfield repo, ask only the single highest-leverage next question from `shipflow draft --json`, then rerun `shipflow draft --json` after each answer
- then narrow into UI, behavior, API, database, performance, security, and technical using ShipFlow's per-type discussion prompts
- surface at most one or two best-practice prompts for the current type
- do not present a long list of open questions spanning several verification types in one turn
- ask clarifications when `shipflow draft` surfaces unresolved decisions
- treat local ShipFlow proposals as first-class; do not abandon the workflow just because no extra AI refinement appeared
- do not inspect ShipFlow examples, templates, or source files to reverse-engineer the YAML format during a normal draft flow

Do NOT report completion until `shipflow verify` exits 0.

Before `shipflow implement`, run `shipflow status --json`. Only continue when `implementation_gate.ready === true`.

## Protected Paths

Never modify these during implementation:
- `vp/**`
- `.gen/**`
- `evidence/**`
- `.shipflow/**`
- `shipflow.json`

## What to Match

The generated checks are the contract:
- match UI locators, text, visibility, and routes exactly
- match API method, path, headers, status, and JSON/body expectations exactly
- match database state and assertions exactly
- match security, technical, and performance constraints exactly

If a verification seems wrong, stop and return to the verification phase with the user.

## Commands

```bash
shipflow draft "<user request>"  # Standard flow: co-draft and refine the verification pack
shipflow draft --clear-session
shipflow draft --accept=vp/path.yml
shipflow draft --pending=vp/path.yml
shipflow draft --accept=vp/path.yml --write
shipflow draft --accept=vp/path.yml --update-existing --write
shipflow implement      # Standard flow: validate, generate, implement, verify
shipflow map            # Advanced: review repo surfaces and coverage gaps
shipflow doctor         # Advanced: check local tools, runners, and adapters
shipflow lint           # Advanced: lint verification quality
shipflow gen            # Advanced: generate runnable tests from the pack
shipflow verify         # Advanced: run generated tests and write evidence
shipflow implement-once # Advanced: single implementation pass, no retry loop
```

Only use `--update-existing` with explicit approval before replacing an existing verification file.
Use `--reject` only when a candidate is explicitly out of scope:

```bash
shipflow draft --reject=vp/path.yml
```

## Gemini Commands

- `/shipflow:draft [description]` — Draft or refine the verification pack
- `/shipflow:implement` — Run the standard implementation loop
