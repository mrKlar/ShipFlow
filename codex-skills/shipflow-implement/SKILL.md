---
name: shipflow-implement
description: "Run the standard ShipFlow implementation loop once the draft is ready."
---

# ShipFlow — Implementation Loop

Use this skill when the user wants to implement or fix the project once the draft is ready.

## Intent

The standard path is a single command:

```bash
shipflow status --json
shipflow implement
```

Only continue when `shipflow status --json` shows `implementation_gate.ready === true`.
Inspect the JSON output directly. Do not pipe it through `python`, `jq`, or shell glue unless ShipFlow returned malformed JSON.
Run `shipflow implement` directly. Do not unset CLI session variables manually; ShipFlow handles nested provider subprocesses itself.

If `implementation_gate.ready !== true`, stop and send the user back to `$shipflow-draft`.

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
shipflow init
```

2. Run the standard loop first:

```bash
shipflow implement
```

If it takes time, inspect `evidence/implement.json` or `shipflow status --json` for the current stage before assuming the loop is stuck.

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

- Never edit `vp/`, `.gen/`, `evidence/`, `.shipflow/`, or `shipflow.json`
- Treat the verification pack as ground truth
- If the verification pack itself is wrong or ambiguous, stop and send the user back to `$shipflow-draft`
