# ShipFlow User Guide

## What is ShipFlow?

ShipFlow is a verification-first framework. You describe what your app must do in YAML files. ShipFlow compiles those into Playwright tests and runs them. The AI implements the code and loops until every test passes.

```
vp/**/*.yml  →  shipflow gen  →  .gen/playwright/*.spec.ts  →  shipflow verify  →  evidence/run.json
```

The only files you write and review are under `vp/`. Everything else is generated.

## Installation

```bash
git clone <shipflow-repo-url>
cd ShipFlow
./install.sh
```

This installs ShipFlow as a Claude Code plugin. Restart Claude Code after installing.

To scaffold a project with CLAUDE.md, hooks, and vp/ directories:

```bash
./install.sh /path/to/your-project
```

Your project needs Playwright:

```bash
cd your-project
npm install -D @playwright/test
npx playwright install
```

## Usage

In Claude Code, open your project and run:

```
/shipflow-verifications a todo app with login
```

The AI drafts verifications immediately. Review, add, or remove checks. Then:

```
/shipflow-impl
```

The AI implements the entire app autonomously, looping until all tests pass.

## Writing Verifications

### UI Checks — `vp/ui/*.yml`

One file per behavior. Each check defines a flow (user actions) and assertions (expected results).

```yaml
id: homepage-title
title: Homepage shows the app name
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /
assert:
  - text_equals: { testid: app-title, equals: "My App" }
```

#### Flow Steps

**open** — Navigate to a path.

```yaml
- open: /dashboard
```

**click** — Click an element. Role defaults to `button` if only `name` is given.

```yaml
- click: { name: "Submit" }            # button by name
- click: { role: link, name: "Home" }  # explicit role
- click: { testid: nav-settings }      # by test ID
- click: { label: "Accept terms" }     # by label
```

**fill** — Type text into an input.

```yaml
- fill: { testid: email, value: "user@example.com" }
- fill: { label: "Password", value: "secret123" }
- fill: { role: textbox, name: "Search", value: "query" }
```

**select** — Pick a dropdown option.

```yaml
- select: { label: "Country", value: "FR" }
- select: { testid: theme-dropdown, value: "dark" }
```

**hover** — Hover over an element (no default role).

```yaml
- hover: { role: button, name: "Menu" }
- hover: { testid: info-icon }
```

**wait_for** — Wait for a duration. Defaults to 250ms.

```yaml
- wait_for: { ms: 500 }
- wait_for: {}
```

#### Assertions

```yaml
- text_equals: { testid: msg, equals: "Welcome" }    # exact match
- text_matches: { testid: msg, regex: "Welcome.*" }   # regex match
- visible: { testid: avatar }                          # element visible
- hidden: { testid: empty-state }                      # element hidden (in DOM)
- url_matches: { regex: "/dashboard" }                 # URL pattern
- count: { testid: card, equals: 5 }                   # element count
```

#### Locator Strategies

All steps support three locator strategies — use one per step:

| Strategy | Field | Playwright |
|---|---|---|
| Role | `role` + `name` | `getByRole("button", { name: "Submit" })` |
| Test ID | `testid` | `getByTestId("my-input")` |
| Label | `label` | `getByLabel("Email")` |

### Behavior Checks — `vp/behavior/*.yml`

Given/When/Then structure for business logic scenarios. Uses the same flow steps and assertions.

```yaml
id: checkout
feature: Shopping Cart
scenario: User completes purchase
severity: blocker
setup: login-as-user
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

Generates a Playwright test with `test.describe(feature)` and Given/When/Then comments.

### API Checks — `vp/api/*.yml`

Verify HTTP endpoints using Playwright's request API (no browser).

```yaml
id: create-user
title: POST /api/users creates a user
severity: blocker
app:
  kind: api
  base_url: http://localhost:3000
request:
  method: POST
  path: /api/users
  headers:
    Authorization: "Bearer admin-token"
  body_json:
    name: "Bob"
    email: "bob@test.com"
assert:
  - status: 201
  - json_equals: { path: "$.name", equals: "Bob" }
```

#### Request Fields

| Field | Description |
|---|---|
| `method` | GET, POST, PUT, PATCH, DELETE |
| `path` | URL path (appended to `base_url`) |
| `headers` | Optional key-value pairs |
| `body` | Optional raw string body |
| `body_json` | Optional JSON body (object/array) |

#### API Assertions

```yaml
- status: 200                                                # HTTP status
- header_equals: { name: "x-request-id", equals: "abc" }    # exact header
- header_matches: { name: "content-type", matches: "json" }  # regex header
- body_contains: "success"                                    # raw body search
- json_equals: { path: "$[0].name", equals: "Alice" }        # JSON value
- json_matches: { path: "$.status", matches: "active" }      # JSON regex
- json_count: { path: "$.items", count: 5 }                  # array length
```

JSON paths: `$` = response body root. `$[0].name` → `body[0].name`, `$.items` → `body.items`.

### DB Checks — `vp/db/*.yml`

Verify database state. Supports SQLite and PostgreSQL.

```yaml
id: users-seeded
title: Users table has seed data
severity: blocker
app:
  kind: db
  engine: sqlite               # sqlite or postgresql
  connection: ./test.db        # file path or connection string
setup_sql: |
  CREATE TABLE IF NOT EXISTS users (name TEXT, email TEXT);
  INSERT INTO users VALUES ('Alice', 'alice@test.com');
query: "SELECT name, email FROM users"
assert:
  - row_count: 1
  - cell_equals: { row: 0, column: name, equals: "Alice" }
  - cell_matches: { row: 0, column: email, matches: "@test\\.com$" }
  - column_contains: { column: name, value: "Alice" }
```

Generates a Playwright test that calls `sqlite3` or `psql` via `execFileSync`, piping SQL through stdin.

### Fixtures — `vp/ui/_fixtures/*.yml`

Reusable setup flows referenced by `setup:` in UI and behavior checks.

```yaml
# vp/ui/_fixtures/auth.yml
id: login-as-user
title: Log in as test user
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /login
  - fill: { label: Email, value: "test@example.com" }
  - fill: { label: Password, value: "testpass" }
  - click: { name: "Sign in" }
  - wait_for: { ms: 300 }
```

Reference it:

```yaml
setup: login-as-user
```

The fixture's flow steps are inlined before the check's own flow in the generated test.

## Running ShipFlow

### Generate tests

```bash
shipflow gen
```

Reads all `vp/**/*.yml` files, validates schemas, generates Playwright specs into `.gen/playwright/`, and creates `.gen/vp.lock.json` (SHA-256 hash of all VP files).

### Run verification

```bash
shipflow verify
```

1. Validates the lock (VP unchanged since `gen`)
2. Runs `npx playwright test .gen/playwright`
3. Writes `evidence/run.json`
4. Exits 0 if all tests pass

### Validation errors

```
Validation failed in vp/ui/login.yml:
  severity: Invalid enum value. Expected 'blocker' | 'warn', received 'critical'
  flow.2.click.name: Required
```

### Lock integrity

If VP files change after `gen`, `verify` fails:

```
Error: Verification pack changed since last generation. Run shipflow gen.
```

## Anti-Cheat

ShipFlow enforces separation between verification and implementation:

| Protected | Contents | Who writes |
|---|---|---|
| `vp/` | Verifications (YAML) | Human + AI (verification phase only) |
| `.gen/` | Generated Playwright tests | `shipflow gen` |
| `evidence/` | Test results | `shipflow verify` |

Claude Code hooks enforce this automatically:
- **PreToolUse** blocks Write/Edit to protected paths
- **Stop** runs `shipflow verify` before the AI can finish

## CI Integration

```yaml
name: ShipFlow Verify
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx shipflow gen
      - run: npx shipflow verify
```
