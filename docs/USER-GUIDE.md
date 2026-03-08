# ShipFlow User Guide

## What is ShipFlow?

ShipFlow is a verification-first framework. You describe what your app must do in YAML files. ShipFlow compiles those into Playwright tests and runs them. The AI implements the code and loops until every test passes.

```
vp/**/*.yml  →  shipflow gen  →  .gen/playwright/*.test.ts  →  shipflow verify  →  evidence/run.json
```

The only files you write and review are under `vp/`. Everything else is generated.

## Installation

One command — auto-detects your AI coding agents:

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
```

Or from a cloned repo:

```bash
git clone https://github.com/mrKlar/ShipFlow.git
cd ShipFlow && ./install.sh
```

The installer:
1. Installs `shipflow` as a global CLI command
2. Detects Claude Code, Codex CLI, Gemini CLI
3. Installs the Claude Code plugin if Claude is found

Restart Claude Code after installing.

### Project setup

In any project directory:

```bash
shipflow init
```

This creates `vp/` directories, `CLAUDE.md`, `.claude/hooks.json`, `shipflow.json`, and `.gitignore`.

Your project needs Playwright:

```bash
npm install -D @playwright/test
npx playwright install
```

### Multi-platform

```bash
shipflow init --codex              # OpenAI Codex CLI
shipflow init --gemini             # Google Gemini CLI
shipflow init --claude --codex     # Multiple platforms
```

## Usage

### With Claude Code

Open your project and run:

```
/shipflow-verifications a todo app with login
```

The AI drafts verifications immediately. Review, add, or remove checks. Then:

```
/shipflow-impl
```

The AI implements the entire app autonomously, looping until all tests pass.

### With the CLI

```bash
shipflow gen       # Compile vp/ → .gen/playwright/*.test.ts
shipflow verify    # Run tests → evidence/run.json
shipflow status    # Show VP counts, test counts, last run
```

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

**route_block** — Mock/block an API call. Useful for testing error handling.

```yaml
- route_block: { path: "/api/calculate", status: 500 }
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
- header_matches: { name: "content-type", regex: "json" }    # regex header
- body_contains: "success"                                    # raw body search
- json_equals: { path: "$[0].name", equals: "Alice" }        # JSON value
- json_matches: { path: "$.status", regex: "active" }        # JSON regex
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
  - cell_matches: { row: 0, column: email, regex: "@test\\.com$" }
  - column_contains: { column: name, value: "Alice" }
```

### NFR Checks — `vp/nfr/*.yml`

Verify non-functional requirements (performance, load). Generates k6 scripts.

```yaml
id: api-load
title: API handles 50 concurrent users
severity: blocker
app:
  kind: nfr
  base_url: http://localhost:3000
scenario:
  endpoint: /api/health
  method: GET
  thresholds:
    http_req_duration_p95: 200
    http_req_failed: 0.01
  vus: 50
  duration: 30s
```

Requires `k6` installed. Runs during `shipflow verify` if available.

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

Reads all `vp/**/*.yml` files, validates schemas, generates Playwright tests into `.gen/playwright/`, k6 scripts into `.gen/k6/`, and creates `.gen/vp.lock.json` (SHA-256 hash of all VP files).

### Run verification

```bash
shipflow verify
```

1. Validates the lock (VP unchanged since `gen`)
2. Evaluates OPA policies (if present)
3. Runs k6 NFR scripts (if present and k6 available)
4. Runs Playwright tests
5. Writes `evidence/run.json`
6. Exits 0 if all tests pass

### Check status

```bash
shipflow status
```

Shows VP file counts, generated test counts, and last run results.

## Anti-Cheat

ShipFlow enforces separation between verification and implementation:

| Protected | Contents | Who writes |
|---|---|---|
| `vp/` | Verifications (YAML) | Human + AI (verification phase only) |
| `.gen/` | Generated Playwright tests | `shipflow gen` |
| `evidence/` | Test results | `shipflow verify` |

Hooks enforce this automatically:
- **PreToolUse** blocks Write/Edit to protected paths
- **Stop** runs `shipflow verify` before the AI can finish
