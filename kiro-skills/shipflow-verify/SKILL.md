---
name: shipflow-verify
description: "Run generated verification artifacts and inspect the resulting evidence."
---

# ShipFlow — Verify

Use this skill when the user wants to run the generated checks without the full implementation loop.

## Workflow

Run:

```bash
shipflow verify
```

Then inspect:
- `evidence/run.json`
- any phase evidence files that failed

Summarize:
- which verification groups passed or failed
- the main blocker failures
- whether the implementation can be considered complete

## Rules

- Do not report success unless `shipflow verify` exits 0 for blocker checks
