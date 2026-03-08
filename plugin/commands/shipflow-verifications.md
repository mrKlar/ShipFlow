---
description: Draft executable verifications for your app — AI writes them, you refine
argument-hint: [what to build or verify]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# ShipFlow — Verification Phase

You are writing executable verifications for the user's app. Be proactive: draft verifications immediately from context, don't interview the user.

## Context

$ARGUMENTS

## Setup

Find the ShipFlow installation. Run:

```bash
SHIPFLOW_DIR="$(find ~/.claude/plugins/cache/shipflow -name 'shipflow.js' -path '*/bin/*' 2>/dev/null | head -1 | xargs dirname | xargs dirname)"
echo "ShipFlow: $SHIPFLOW_DIR"
```

Use `node $SHIPFLOW_DIR/bin/shipflow.js` for all shipflow commands.

## Process

### Step 1: Read context (silently)

Quickly scan what exists — do NOT narrate this to the user:
- `shipflow.json` — project config
- `vp/**/*.yml` — existing checks (ui, behavior, api, db, nfr, security)
- `src/` — existing app code (if any)
- Project name, README, CLAUDE.md — for intent

Then run:

```bash
node $SHIPFLOW_DIR/bin/shipflow.js map
```

Use that repo map plus `$ARGUMENTS` to decide what to cover first, which verification types are missing, and where precision is most needed.

### Step 2: Build a coverage plan, then draft verifications NOW

From the project name, the repo map, the user's description (`$ARGUMENTS`), and any existing code, **immediately write VP check files**. Don't ask what to verify first — infer it. Be opinionated. Cover the obvious flows and the important risks.

For a new project: scaffold `shipflow.json` and the `vp/` directories too.

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
  - fill: { label: "Card", value: "4111111111111111" }
  - click: { name: "Pay" }
then:
  - url_matches: { regex: "/confirmation" }
  - visible: { testid: success-message }
```

Uses the same flow steps and assertions as UI checks, organized as given/when/then.

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
  headers:
    Authorization: "Bearer test-token"
assert:
  - status: 200
  - json_count: { path: "$", count: 3 }
  - json_equals: { path: "$[0].name", equals: "Alice" }
```

Methods: GET, POST, PUT, PATCH, DELETE. Optional: `headers`, `body` (string), `body_json` (object).

Assertions: `status`, `header_equals`, `header_matches`, `body_contains`, `json_equals`, `json_matches` (with `regex` field), `json_count`.

#### DB checks — `vp/db/*.yml`
For verifying database state.

```yaml
id: unique-id
title: What this verifies
severity: blocker
app:
  kind: db
  engine: sqlite       # or postgresql
  connection: ./test.db
setup_sql: |
  INSERT INTO users (name) VALUES ('Alice');
query: "SELECT name FROM users"
assert:
  - row_count: 1
  - cell_equals: { row: 0, column: name, equals: "Alice" }
```

Assertions: `row_count`, `cell_equals`, `cell_matches`, `column_contains`.

#### Security checks — `vp/security/*.yml`
For verifying access control, security headers, input rejection, and data exposure constraints through concrete HTTP checks.

```yaml
id: guest-admin-rejected
title: Guest access to admin endpoint is rejected
severity: blocker
category: authz
app:
  kind: security
  base_url: http://localhost:3000
request:
  method: GET
  path: /api/admin
assert:
  - status: 401
  - header_absent: { name: x-internal-token }
  - body_not_contains: "stack trace"
```

Categories: `authn`, `authz`, `headers`, `input_validation`, `cors`, `session`, `exposure`, `rate_limit`, `other`.

Assertions: `status`, `header_equals`, `header_matches`, `header_absent`, `body_contains`, `body_not_contains`.

#### Fixtures — `vp/ui/_fixtures/*.yml`
Reusable setup flows (login, etc.) referenced by `setup:` in UI and behavior checks.

### Step 3: Validate

First lint the pack quality:

```bash
node $SHIPFLOW_DIR/bin/shipflow.js lint
```

Fix any duplicate ids, weak assertions, missing statuses, or vague checks.

Then run gen to confirm the checks compile:

```bash
node $SHIPFLOW_DIR/bin/shipflow.js gen
```

Fix any YAML errors and retry until both lint and gen succeed.

### Step 4: Present to the user

Show a short summary of what you drafted:
- List each check: id, title, type (UI/behavior/API/database/performance/security), what it verifies
- Mention the main gaps you intentionally left for a second pass
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
- Choose the right verification type: UI for visual, behavior for scenarios, API for endpoints, DB for data, NFR for load/perf, security for auth/headers/exposure
- Prefer precise, observable checks over broad narrative checks
- Use `shipflow map` before writing and `shipflow lint` before finishing
