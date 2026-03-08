---
name: shipflow-verifications
description: Collaboratively draft or refine a ShipFlow verification pack. Preferred follow-up command: $shipflow-implement. Legacy follow-up alias: $shipflow-impl.
---

# ShipFlow — Verification Collaboration

Use this skill when the user wants to define, review, add, remove, or tighten ShipFlow verifications.

## Intent

This is a human + AI collaboration phase, not an autonomous one-shot.
Your job is to help the user shape a precise verification pack under `vp/`, then validate it with ShipFlow.

## Workflow

1. If the project has no `shipflow.json`, run:

```bash
shipflow init
```

2. Build context before writing:
- Read the user request
- Review existing `vp/` files if they exist
- Run `shipflow map --json` when repo context matters
- Run `shipflow draft --json "<user request>"` when starter proposals would help

3. Draft or refine the verification pack in collaboration with the user:
- Write focused checks under `vp/`
- Prefer one observable behavior per file
- Cover the relevant types: UI, behavior, API, database, performance, security, technical
- Call out ambiguities instead of hiding them
- Use `shipflow draft --write "<user request>"` only when starter files are actually useful

4. Validate every pass:

```bash
shipflow lint
shipflow gen
```

5. Present a short summary:
- what was added or changed
- what is still ambiguous
- what is intentionally not covered yet

6. Iterate until the user is satisfied, then direct them to:

```text
$shipflow-implement
```

Legacy alias:

```text
$shipflow-impl
```

## Rules

- Do not pretend the first draft is complete
- Do not optimize for check count; optimize for precision
- Prefer stable selectors and concrete assertions
- Use `warn` only for genuinely non-blocking checks
- If validation fails, fix the pack before presenting it as ready
