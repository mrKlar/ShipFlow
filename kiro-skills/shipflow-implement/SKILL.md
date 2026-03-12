---
name: shipflow-implement
description: "Run the standard ShipFlow implementation loop once the draft is ready."
---

# ShipFlow — Implementation Loop

Use this skill when the user wants to implement or fix the project once the draft is ready.

## Workflow

1. If the project has no `shipflow.json`, run:

```bash
shipflow init
```

2. Run the standard path first:

```bash
shipflow status --json
shipflow implement
```

Only continue when `shipflow status --json` shows `implementation_gate.ready === true`.
Run the installed `shipflow` CLI directly. If it is not on `PATH`, retry `~/.local/bin/shipflow` directly. Do not inspect the wrapper or the installed ShipFlow package to infer the workflow.
Inspect the JSON output directly. Do not pipe it through `python`, `jq`, or shell glue unless ShipFlow returned malformed JSON.
Run `shipflow implement` directly. Do not unset CLI session variables manually; ShipFlow handles nested provider subprocesses itself.

If `implementation_gate.ready !== true`, stop and send the user back to `shipflow-draft`.

If the loop takes time, inspect `evidence/implement.json` or `shipflow status --json` for the current stage before assuming it is stuck.

Use the installed Kiro native custom agents from `.kiro/agents` or `~/.kiro/agents` during implementation:
- `shipflow-strategy-lead` for orchestration and strategy changes when the loop stalls
- `shipflow-architecture-specialist`, `shipflow-ui-specialist`, `shipflow-api-specialist`, `shipflow-database-specialist`, `shipflow-security-specialist`, `shipflow-technical-specialist` for narrow repair slices
- keep each subagent delegation tied to one verification slice and one evidence target
- let the orchestrator own the global loop and integration decisions

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
- Fix real backend, database, runtime, and dependency failures instead of faking green. Never hardcode expected outputs, bypass storage, suppress errors, or stub around a broken system just to satisfy checks.
- If `vp/domain/**` exists, treat it as the business-domain source of truth. Do a real data-engineering step from business objects to technical storage/read/write/exchange objects, and normalize driver-native values such as BigInt ids, numeric strings, binary payloads, or DB timestamps before exposing them through JSON, REST, GraphQL, UI state, or events.
- For browser UI work, reuse the design system or open-source design-system component library already present in the repo. If none exists and the user did not explicitly ask for a bespoke internal UI kit, use a standard, widely used open-source design-system component library appropriate to the stack instead of inventing one-off primitives. Only create a new local shared component library when the user explicitly asks for it or the repo already follows that pattern.
- If the verification pack itself is wrong or ambiguous, stop and send the user back to `shipflow-draft`
