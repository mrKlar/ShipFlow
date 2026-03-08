# ShipFlow

This project uses ShipFlow for verification-first development with Gemini CLI.

## Two Phases

### Phase 1: Verification (human + AI)

Draft verifications in `vp/` together with the user. Use natural-language collaboration to tighten coverage before writing or updating files.

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

Implement app code that passes the generated verification checks. Treat the reviewed verification pack as ground truth; if it is wrong or ambiguous, stop and ask for pack changes.

## Gemini Flow

Use the low-friction flow first:

```text
1. Collaborate on the verification pack
2. Prefer `shipflow draft "<user request>"` when starter proposals would help
3. Prefer `shipflow implement` for the standard implementation loop
4. Use granular commands only for debugging or inspection
```

Typical handoff:
- `/shipflow:verifications` to draft or refine the pack
- review and tighten the pack with the user
- `/shipflow:implement` once the pack is reviewed

Do NOT report completion until `shipflow verify` exits 0.

## Protected Paths

Never modify these during implementation:
- `vp/**`
- `.gen/**`
- `evidence/**`
- `shipflow.json`
- `playwright.config.ts`

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
shipflow implement      # Standard flow: validate, generate, implement, verify
shipflow map            # Advanced: review repo surfaces and coverage gaps
shipflow doctor         # Advanced: check local tools, runners, and adapters
shipflow lint           # Advanced: lint verification quality
shipflow gen            # Advanced: generate runnable tests from the pack
shipflow verify         # Advanced: run generated tests and write evidence
shipflow implement-once # Advanced: single implementation pass, no retry loop
```

## Gemini Commands

- `/shipflow:verifications [description]` — Collaboratively draft or refine the verification pack
- `/shipflow:implement` — Run the standard implementation loop
- `/shipflow:impl` — Legacy alias
