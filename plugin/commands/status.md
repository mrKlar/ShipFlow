---
description: Show verification-pack, generated-artifact, and evidence status
allowed-tools: Read, Glob, Grep, Bash
---

# ShipFlow — Status

Use this command when the user wants a compact state check without drafting, generating, or verifying anything.

## Workflow

Run:

```bash
shipflow status --json
```

Summarize:
- verification-pack presence and counts
- implementation gate readiness
- generated artifact state
- recent evidence state

## Rules

- Prefer the JSON output as the source of truth
- Do not infer a green state if the gate or evidence says otherwise
