---
name: shipflow-doctor
description: "Check ShipFlow runtime, adapters, and required verification backends."
---

# ShipFlow — Doctor

Use this skill when the user wants an environment diagnosis before drafting, generating, verifying, or implementing.

## Workflow

Run:

```bash
shipflow doctor --json
```

Summarize:
- whether the environment is ready
- which providers or verification backends are missing
- the minimal next step to unblock progress

## Rules

- Do not change the repo from this skill unless the user explicitly asked you to fix the environment
