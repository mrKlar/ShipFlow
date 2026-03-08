---
name: shipflow-verifications
description: Draft executable ShipFlow verifications for an app. Use when the user wants to create or update VP verification files, define what an app must do, or start a new ShipFlow project. Do NOT use for implementation — use $shipflow-impl instead.
---

# ShipFlow — Verification Phase

You are writing executable verifications for the user's app. Be proactive: draft verifications immediately from context, don't interview the user.

## Context

$ARGUMENTS

## Process

### Step 1: Read context (silently)

Quickly scan what exists — do NOT narrate this to the user:
- `shipflow.json` — project config
- `vp/**/*.yml` — existing checks (ui, behavior, api, db)
- `src/` — existing app code (if any)
- Project name, README — for intent

If no `shipflow.json` exists, run `shipflow init --codex` first.

### Step 2: Draft verifications NOW

From the project name, user's description, and any existing code, **immediately write VP check files**. Don't ask what to verify — infer it. Be opinionated. Cover the obvious flows.

Choose the right verification type for each behavior:

#### UI checks — `vp/ui/*.yml`
For verifying what users see and interact with in the browser.

```yaml
id: unique-id
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

Flow steps: `open`, `fill` (testid/label + value), `click` (name/testid/role), `select` (label/testid + value), `hover` (role/testid), `wait_for` (ms), `route_block` (path + status, to mock/block API calls).

Assertions: `text_equals`, `text_matches`, `visible`, `hidden`, `url_matches`, `count`.

#### Behavior checks — `vp/behavior/*.yml`
For verifying business logic scenarios with Given/When/Then structure.

```yaml
id: unique-id
feature: Feature Name
scenario: What happens in this scenario
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
given:
  - open: /products
  - click: { testid: add-to-cart }
when:
  - click: { name: "Checkout" }
then:
  - url_matches: { regex: "/confirmation" }
  - visible: { testid: success-message }
```

#### API checks — `vp/api/*.yml`
For verifying HTTP endpoints.

```yaml
id: unique-id
title: What this verifies
severity: blocker
app:
  kind: api
  base_url: http://localhost:3000
request:
  method: GET
  path: /api/users
assert:
  - status: 200
  - json_count: { path: "$", count: 3 }
  - json_equals: { path: "$[0].name", equals: "Alice" }
```

#### DB checks — `vp/db/*.yml`
For verifying database state.

```yaml
id: unique-id
title: What this verifies
severity: blocker
app:
  kind: db
  engine: sqlite
  connection: ./test.db
query: "SELECT name FROM users"
assert:
  - row_count: 1
  - cell_equals: { row: 0, column: name, equals: "Alice" }
```

#### Fixtures — `vp/ui/_fixtures/*.yml`
Reusable setup flows (login, etc.) referenced by `setup:` in UI and behavior checks.

### Step 3: Validate

Run gen to confirm the checks compile:

```bash
shipflow gen
```

Fix any YAML errors and retry until gen succeeds.

### Step 4: Present to the user

Show a short summary of what you drafted:
- List each check: id, title, type (UI/behavior/API/DB), what it verifies
- Say "These are your verifications. Tell me what to add, remove, or change."

### Step 5: Iterate

When the user gives feedback:
- Add/remove/modify checks
- Re-run gen to validate
- Show updated summary

Repeat until the user is satisfied, then tell them to use `$shipflow-impl` to build the app.

## Rules

- **Be proactive** — draft first, ask later. Never open with questions.
- One behavior per check, keep flows short
- Use `data-testid` for element targeting, `label` for form inputs, `name` for buttons
- `severity: blocker` for core functionality, `warn` for nice-to-have
- Choose the right verification type: UI for visual, behavior for scenarios, API for endpoints, DB for data
