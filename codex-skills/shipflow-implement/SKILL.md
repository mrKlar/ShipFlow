---
name: shipflow-implement
description: Run the standard ShipFlow implementation loop against the reviewed verification pack.
---

# ShipFlow — Implementation Loop

Use this skill when the user wants to implement or fix the project against an already reviewed verification pack.

## Intent

The standard path is a single command:

```bash
shipflow implement
```

That command already runs the useful pipeline:
- doctor
- lint
- gen
- implementation
- verify
- retry until green or budget exhausted

## Workflow

1. If the project has no `shipflow.json`, run:

```bash
shipflow init --codex
```

2. Run the standard loop first:

```bash
shipflow implement
```

3. Only if that fails, inspect:
- `evidence/implement.json`
- `evidence/run.json`
- generated tests under `.gen/`
- the current code under the configured `srcDir`

4. Drop to granular commands only for debugging:

```bash
shipflow doctor
shipflow lint
shipflow gen
shipflow verify
shipflow status
```

5. Fix the code under the configured `srcDir`, then resume the loop.

## Rules

- Never edit `vp/`, `.gen/`, `evidence/`, `shipflow.json`, or `playwright.config.ts`
- Treat the reviewed verification pack as ground truth
- If the verification pack itself is wrong or ambiguous, stop and send the user back to `$shipflow-verifications`
