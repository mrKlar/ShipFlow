---
name: shipflow-verifications
description: Collaboratively draft or refine a ShipFlow verification pack. Preferred follow-up skill: shipflow-implement.
---

# ShipFlow — Verification Collaboration

Use this skill when the user wants to define, review, add, remove, or tighten ShipFlow verifications.

## Intent

This phase is human + AI collaboration. Help the user shape a precise verification pack under `vp/`, then validate it with ShipFlow.

## Workflow

1. If the project has no `shipflow.json`, run:

```bash
shipflow init
```

2. Gather context before writing:
- read the user request
- review existing `vp/` files
- run `shipflow map --json` when repo context matters
- run `shipflow draft --json "<user request>"` when starter proposals would help

3. Draft or refine the verification pack:
- write focused checks under `vp/`
- prefer one observable behavior per file
- cover the relevant types: UI, behavior, API, database, performance, security, technical
- call out ambiguities instead of burying them
- use `shipflow draft --write "<user request>"` only when starter files are actually useful

4. Validate every pass:

```bash
shipflow lint
shipflow gen
```

5. Present a short summary:
- what was added or changed
- what is still ambiguous
- what is intentionally not covered yet

6. When the user is satisfied, move to the standard implementation loop with `shipflow-implement`.

## Rules

- Do not pretend the first draft is complete
- Do not optimize for check count; optimize for precision
- Prefer stable selectors and concrete assertions
- If validation fails, fix the pack before presenting it as ready
