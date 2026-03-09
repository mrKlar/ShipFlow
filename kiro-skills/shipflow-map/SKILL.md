---
name: shipflow-map
description: "Inspect repo surfaces and coverage gaps before or during drafting."
---

# ShipFlow — Repo Map

Use this skill when the user wants a brownfield scan, coverage-gap review, or a repo-aware drafting starting point.

## Workflow

Run:

```bash
shipflow map --json "<user request>"
```

Then summarize:
- detected UI, behavior, API, database, security, performance, and technical surfaces
- the biggest coverage gaps
- the ambiguities that still need an explicit decision

## Rules

- Do not write files from this skill
- If the user wants to refine or materialize the pack after the map, move to `shipflow-draft`
