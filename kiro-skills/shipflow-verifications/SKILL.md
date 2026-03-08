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
- run `shipflow map --json "<user request>"` when repo context matters
- run `shipflow draft --json "<user request>"` when starter proposals would help

If the user is continuing an existing review session, you may omit the request and let ShipFlow reuse the saved draft request.
If the user wants to restart the review from scratch, use `shipflow draft --clear-session`.

3. Review proposals with the user before writing:
- use `shipflow draft --accept=vp/path.yml` and `shipflow draft --reject=vp/path.yml` to record decisions
- use `shipflow draft --accept=vp/path.yml --write` to materialize an accepted proposal
- use `shipflow draft --accept=vp/path.yml --update-existing --write` only with explicit user approval when replacing an existing verification file
- for precise refinements that do not fit a proposal cleanly, edit focused checks under `vp/` manually
- prefer one observable behavior per file
- cover the relevant types: UI, behavior, API, database, performance, security, technical
- call out ambiguities instead of burying them
- do not jump straight to `--write` before the user has reviewed the proposal set

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
- Do not replace an existing `vp/` file unless the user explicitly approved that update
- If validation fails, fix the pack before presenting it as ready
