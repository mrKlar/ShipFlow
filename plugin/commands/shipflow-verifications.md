---
description: Draft executable verifications for your app — AI writes them, you refine
argument-hint: [what to build or verify]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# ShipFlow — Verification Phase

You are writing executable verifications (VP checks) for the user's app. Be proactive: draft verifications immediately from context, don't interview the user.

## Context

$ARGUMENTS

## Process

### Step 1: Read context (silently)

Quickly scan what exists — do NOT narrate this to the user:
- `shipflow.json` — project config
- `vp/ui/*.yml`, `vp/ui/_fixtures/*.yml` — existing checks
- `src/` — existing app code (if any)
- Project name, README, CLAUDE.md — for intent

### Step 2: Draft verifications NOW

From the project name, user's description (`$ARGUMENTS`), and any existing code, **immediately write VP check files** to `vp/ui/`. Don't ask what to verify — infer it. Be opinionated. Cover the obvious user flows.

For a new project: scaffold `shipflow.json` and `vp/ui/` too.

Write checks as `vp/ui/*.yml`:

```yaml
id: unique-check-id
title: What this verifies
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /
  - fill: { testid: x, value: "text" }
  - click: { name: "Button" }
assert:
  - text_equals: { testid: x, equals: "Expected" }
```

Available flow steps: `open`, `fill` (testid/label + value), `click` (name/testid/role), `select` (label/testid + value), `hover` (role/testid), `wait_for` (ms).

Available assertions: `text_equals` (testid + equals), `text_matches` (testid + regex), `visible` (testid), `hidden` (testid), `url_matches` (regex), `count` (testid + equals).

Use fixtures (`vp/ui/_fixtures/*.yml`) for repeated setup like login.

### Step 3: Validate

Run gen to confirm the checks compile:

```bash
node <shipflow-path>/bin/shipflow.js gen
```

Fix any YAML errors and retry until gen succeeds.

### Step 4: Present to the user

Show a short summary of what you drafted:
- List each check: id, title, what it verifies
- Say "These are your verifications. Tell me what to add, remove, or change."

That's it. Don't ask for approval on each one. Let the user react.

### Step 5: Iterate

When the user gives feedback:
- Add/remove/modify checks
- Re-run gen to validate
- Show updated summary

Repeat until the user is satisfied, then tell them to run `/shipflow-impl` to build the app.

## Rules

- **Be proactive** — draft first, ask later. Never open with questions.
- One behavior per check, keep flows short
- Use `data-testid` for element targeting, `label` for form inputs, `name` for buttons
- `severity: blocker` for core functionality, `warn` for nice-to-have
- If the project has no `shipflow.json`, create one with sensible defaults
