---
name: shipflow-status
description: "Show verification-pack, generated-artifact, and evidence status."
---

# ShipFlow — Status

Use this skill when the user wants a compact state check without drafting, generating, or verifying anything.

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
