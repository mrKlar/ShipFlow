---
description: Inspect repo surfaces and coverage gaps before or during drafting
argument-hint: [scope or feature]
allowed-tools: Read, Glob, Grep, Bash
---

# ShipFlow — Repo Map

Use this command when the user wants a brownfield scan, coverage-gap review, or a repo-aware draft starting point.

## Context

$ARGUMENTS

## Workflow

Run:

```bash
shipflow map --json "$ARGUMENTS"
```

Then summarize:
- detected UI, behavior, API, database, security, performance, and technical surfaces
- the biggest coverage gaps
- the ambiguities that still need an explicit decision

## Rules

- Do not write files from this command
- Do not reverse-engineer ShipFlow internals from examples or templates
- If the user wants to materialize or refine the pack after the map, switch to `/shipflow:draft`
