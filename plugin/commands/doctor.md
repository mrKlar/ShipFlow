---
description: Check local ShipFlow runtime, adapters, and required verification backends
allowed-tools: Read, Glob, Grep, Bash
---

# ShipFlow — Doctor

Use this command when the user wants an environment diagnosis before drafting, generating, verifying, or implementing.

## Workflow

Run:

```bash
shipflow doctor --json
```

Summarize:
- whether the environment is ready
- which providers and verification backends are missing
- the minimal next step to make progress

## Rules

- Do not change the repo from this command unless the user explicitly asked you to fix the environment
- Prefer the JSON output as the source of truth
