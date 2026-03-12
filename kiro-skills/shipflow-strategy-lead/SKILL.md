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
- Use the native specialist agents for narrow slices:
  - `shipflow-architecture-specialist`
  - `shipflow-ui-specialist`
  - `shipflow-api-specialist`
  - `shipflow-database-specialist`
  - `shipflow-security-specialist`
  - `shipflow-technical-specialist`
- When no new blocker checks passed, force a materially different approach
