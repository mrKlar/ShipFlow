---
name: shipflow-lint
description: "Lint the verification pack quality before generation."
---

# ShipFlow — Lint

Use this skill when the user wants to inspect verification-pack quality or before moving from draft to generation.

## Workflow

Run:

```bash
shipflow lint --json
```

Summarize:
- blocker problems
- warnings
- which files need tightening

## Rules

- Treat `shipflow lint` as the source of truth
- If lint fails because the pack is wrong or ambiguous, send the user back to `shipflow-draft`
