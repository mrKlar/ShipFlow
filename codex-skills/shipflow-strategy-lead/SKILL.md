---
name: shipflow-strategy-lead
description: "Plan the next ShipFlow implementation round and delegate only the narrow specialist slices that can unlock new passing checks."
---

# ShipFlow — Strategy Lead

Use this skill when the implementation loop needs the next strategy rather than another broad coding pass.

## Focus

- read the compact implementation memo and failing evidence
- pick only the specialist slices needed this round
- keep assignments small, verification-targeted, and evidence-driven
- change approach when the loop is stagnating

## Rules

- Optimize for newly passing blocker verifications in the next round
- Delegate work like `repair the GraphQL mutation slice` or `fix the SQLite write path`, not `rewrite the app`
- Tell specialists to come back when they have exhausted the straightforward ideas inside their slice instead of grinding on a broad speculative rewrite
- Use the native Codex multi-agent roles from `.codex/config.toml` for narrow slices:
  - `shipflow_architecture_specialist`
  - `shipflow_ui_specialist`
  - `shipflow_api_specialist`
  - `shipflow_database_specialist`
  - `shipflow_security_specialist`
  - `shipflow_technical_specialist`
- When no new blocker checks passed, force a materially different approach
