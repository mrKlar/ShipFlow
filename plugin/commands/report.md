---
description: Aggregate snapshot of the verification pack — for weekly status notes
argument-hint: [--markdown | --json]
allowed-tools: Read, Glob, Grep, Bash
---

# ShipFlow — Report

Use this command when you want the current state of the substrate condensed into something a human reads in 30 seconds — for a weekly Slack note, a status email, or a periodic check-in. It is the right tool when `shipflow trace --pr-comment` would be too narrow (PR-scoped) and `shipflow status` would be too noisy (every detail).

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

```bash
shipflow report
shipflow report --markdown   # paste into Slack / Notion / Confluence
shipflow report --json       # pipe into dashboards
```

## What it surfaces

- **Pack** — vp count by area + policy gates count
- **Substrate** — decisions (linked vs orphan), grill sessions by role, slices by status, vp coverage inside slices
- **Approval** — latest approval, days ago, whether it still matches the current pack hash
- **Reviews** — open vs total, oldest open review and how long it has been open
- **Evidence** — last verify run (PASS/FAIL, days ago, passed/failed counts), last implement run

## Rules

- A latest approval older than 14 days OR not matching the current pack hash is a flag to bring up in the weekly note.
- An oldest open review older than 14 days is a flag too — reviews that age out without resolution are signal that the pack drifted from the team's mental model.
- Pair `shipflow report --markdown` with a recurring CI cron (weekly) to commit the snapshot to a `reports/` directory and turn it into a project changelog.
