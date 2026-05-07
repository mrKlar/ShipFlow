---
description: List concrete artifacts available for human review
allowed-tools: Read, Glob, Grep, Bash
---

# ShipFlow — Preview

Use this command when you want to see what concrete material the team has on hand to review against the verification pack right now: vp files, slices, decisions, evidence files, and any UI screenshots.

A verification pack written in the abstract drifts from the team's mental model. `preview` is the surface that lets a reviewer ground feedback in something concrete: "this empty state copy is too generic", "this API sample is missing pagination", "this slice has no negative case".

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

```bash
shipflow preview
shipflow preview --json
```

The output groups available artifacts by kind (slice, vp, decision, evidence, screenshot) and flags any target that already has open reviews on it.

## Rules

- Treat `shipflow preview` as the entry point for a structured review session. After running it, walk through items with the user and capture every concern with `/shipflow:review-artifact new`.
- If `preview` returns nothing concrete, the pack is being authored in the abstract. Recommend the user run `/shipflow:grill` first, then propose a vp scaffold.
- For UI surfaces, also offer to run `shipflow approve-visual` to capture / refresh baselines before review.
