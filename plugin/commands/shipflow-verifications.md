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
- `vp/**/*.yml` — existing checks (ui, behavior, api, db, nfr, security, technical)
- `src/` — existing app code (if any)
- Project name, README, CLAUDE.md — for intent

Then run:

```bash
node $SHIPFLOW_DIR/bin/shipflow.js map
node $SHIPFLOW_DIR/bin/shipflow.js draft
```

Use that repo map and draft summary plus `$ARGUMENTS` to decide what to cover first, which verification types are missing, what the main gaps are, and what remains ambiguous.

### Step 2: Build a coverage plan, review ambiguities, then draft verifications NOW

From the project name, the repo map, the local draft summary, the user's description (`$ARGUMENTS`), and any existing code, **immediately write VP check files**. Don't ask what to verify first — infer it. Be opinionated. Cover the obvious flows and the important risks.

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

#### Technical checks — `vp/technical/*.yml`
For verifying repository-level technical constraints: framework choice, architecture boundaries, infrastructure files, SaaS/tooling, CI workflows, browser/mobile testing services.

```yaml
id: technical-ci-stack
title: Repository uses GitHub Actions and Playwright
severity: blocker
category: ci
runner:
  kind: custom
  framework: custom
app:
  kind: technical
  root: .
assert:
  - path_exists: { path: ".github/workflows/ci.yml" }
  - dependency_present: { name: "@playwright/test", section: devDependencies }
  - github_action_uses: { workflow: ".github/workflows/ci.yml", action: "actions/checkout@v4" }
```

Categories: `framework`, `architecture`, `infrastructure`, `saas`, `ci`, `testing`, `mobile`, `web`, `other`.

Runners:
- `custom` — built-in repo inspection engine
- `archtest` — architecture-oriented checks; use this when you want to validate boundaries or layering rules

Typical architecture tools for `runner.framework`: `dependency-cruiser`, `tsarch`, `madge`, `eslint-plugin-boundaries`.

Example architecture checks:

```yaml
id: technical-architecture-boundaries
title: Domain layer stays isolated from UI
severity: blocker
category: architecture
runner:
  kind: archtest
  framework: tsarch
app:
  kind: technical
  root: .
assert:
  - imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/", "react"] }
  - command_succeeds: { command: "npx tsarch --help" }
```

Assertions:
- `path_exists`, `path_absent`
- `file_contains`, `file_not_contains`
- `json_has`, `json_equals`
- `dependency_present`, `dependency_absent`
- `github_action_uses`
- `glob_count`
- `imports_forbidden`

#### Fixtures — `vp/ui/_fixtures/*.yml`
Reusable setup flows (login, etc.) referenced by `setup:` in UI and behavior checks.

### Step 3: Validate

First lint the pack quality:

```bash
node $SHIPFLOW_DIR/bin/shipflow.js doctor
node $SHIPFLOW_DIR/bin/shipflow.js lint
```

Fix any environment problems, duplicate ids, weak assertions, missing statuses, or vague checks.

Then run gen to confirm the checks compile:

```bash
node $SHIPFLOW_DIR/bin/shipflow.js gen
```

Fix any YAML errors and retry until both lint and gen succeed.

### Step 4: Present to the user

Show a short summary of what you drafted:
- List each check: id, title, type (UI/behavior/API/database/performance/security/technical), what it verifies
- Mention the main gaps you intentionally left for a second pass
- Say "These are your verifications. Tell me what to add, remove, or change."

That's it. Don't ask for approval on each one. Let the user react.

### Step 5: Iterate

When the user gives feedback:
- Add/remove/modify checks
- Re-run gen to validate
- Show updated summary

Repeat until the user is satisfied, then tell them to run `/shipflow-implement` to build the app.

## Rules

- **Be proactive** — draft first, ask later. Never open with questions.
- One behavior per check, keep flows short
- Use `data-testid` for element targeting, `label` for form inputs, `name` for buttons
- `severity: blocker` for core functionality, `warn` for nice-to-have
- If the project has no `shipflow.json`, create one with sensible defaults
- Choose the right verification type: UI for visual, behavior for scenarios, API for endpoints, database for data, performance for load/perf, security for auth/headers/exposure, technical for frameworks/architecture/CI/infra/tooling
- Prefer precise, observable checks over broad narrative checks
- Use `shipflow map` and `shipflow draft` before writing, and `shipflow doctor` + `shipflow lint` before finishing
