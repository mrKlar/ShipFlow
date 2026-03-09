---
description: Generate runnable verification artifacts from the current pack
allowed-tools: Read, Glob, Grep, Bash
---

# ShipFlow — Generate

Use this command when the user wants to compile the verification pack into runnable artifacts.

## Workflow

Run:

```bash
shipflow gen
shipflow status --json
```

Summarize:
- which artifact groups were generated
- whether the lock is fresh
- whether the pack is ready to verify or implement

## Rules

- Do not hand-edit `.gen/`
- If generation fails, report the failing verification files clearly
