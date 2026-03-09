# ShipFlow User Guide

## What is ShipFlow?

ShipFlow is a verification-first shipping framework. You describe what your app must do, you and/or the AI turn that into a verification pack, ShipFlow compiles it into runnable tests, and the AI implements against that locked pack.

```
vp/**/*.yml  →  shipflow gen  →  .gen/playwright/*.test.ts + .gen/cucumber/** + .gen/k6/*.js + .gen/technical/*.runner.mjs  →  shipflow verify  →  evidence/*.json
```

The only files you define and edit are under `vp/`. Everything else is generated.

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
2. Auto-detects Claude Code, Codex CLI, Gemini CLI, Kiro CLI
3. Installs native integrations for each detected platform:
   - **Claude Code** — plugin
   - **Codex CLI** — skills + exec policy rules + global instructions
   - **Gemini CLI** — extension + BeforeTool guard hooks
   - **Kiro CLI** — skills + steering context

Restart Claude Code after installing.

### Project setup

In any project directory:

```bash
shipflow init
```

This creates `vp/` directories, `shipflow.json`, `.gitignore`, and the project-local files for the selected platform(s), such as `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `KIRO.md`, `.claude/hooks.json`, or `.gemini/settings.json`.
By default, `shipflow init` scaffolds the files for the currently detected CLI. Use explicit flags when you want another surface or multiple surfaces.

For the normal greenfield flow, `shipflow implement` now bootstraps the JS verification runtime it needs when possible, including packages such as `@playwright/test` or `@cucumber/cucumber`, and generates its own Playwright runtime config under `.gen/`.
Native binaries such as `psql`, `k6`, or `opa` still need to exist when your verification pack requires them. SQLite checks can use `sqlite3` when it is installed, or fall back to Node's `node:sqlite` runtime on newer Node versions.

### Multi-platform

```bash
shipflow init --codex              # OpenAI Codex CLI
shipflow init --gemini             # Google Gemini CLI
shipflow init --kiro               # AWS Kiro CLI
shipflow init --claude --codex     # Multiple platforms
shipflow init --all                # All platforms
```

## Agent Workflow

### With Claude Code

Open your project and run:

```
/shipflow-draft a todo app with login
```

Use that first pass as the draft flow. Tighten it, add missing checks, remove weak ones, then:

```
/shipflow-implement
```

### With Codex CLI

Open your project and invoke the skills:

```
$shipflow-draft a todo app with login
```

Review and iterate with the AI. Then:

```
$shipflow-implement
```

### With Gemini CLI

Open your project and use the slash commands:

```
/shipflow:draft a todo app with login
```

Review and iterate with the AI. Then:

```
/shipflow:implement
```

### With Kiro CLI

Open your project. Skills auto-activate when your request matches:

```
"let's draft ShipFlow verifications for a todo app with login"
```

Review and iterate with the AI. Then:

```
"run shipflow implement once the draft is ready"
```

### All platforms

`shipflow implement` is the standard loop. It validates the verification pack, generates tests, applies code changes, runs verification, and retries within the configured budget.

### CLI commands

```bash
shipflow draft "<user request>"  # Standard flow: co-draft and refine the verification pack
shipflow implement   # Standard flow: validate, generate, implement, verify

# Advanced / debug
shipflow map "<user request>"
shipflow doctor
shipflow lint
shipflow gen
shipflow verify
shipflow status
shipflow implement-once
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

Given/When/Then scenario checks. Web scenarios can reuse UI-style flow steps and assertions, API scenarios can issue request steps, and TUI scenarios can drive stdin/stdout flows.
Default execution is surface-specific: Playwright browser for web, Playwright request for API behavior, and a node PTY harness for TUI behavior. You can also target Gherkin/Cucumber generation and execution.

```yaml
id: checkout
feature: Shopping Cart
scenario: User completes purchase
severity: blocker
runner:
  kind: gherkin                # optional: playwright or gherkin
  framework: cucumber          # optional: playwright or cucumber
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

API behavior example:

```yaml
id: checkout-api
feature: Checkout API
scenario: Authenticated checkout succeeds
severity: blocker
app:
  kind: api
  base_url: http://localhost:3000
given: []
when:
  - request:
      method: POST
      path: /api/checkout
      body_json: { sku: "sku-1" }
then:
  - status: 201
  - json_type: { path: "$", type: object }
```

TUI behavior example:

```yaml
id: cli-help
feature: CLI
scenario: Help command is available
severity: blocker
app:
  kind: tui
  command: node
  args: ["./src/cli.js"]
when:
  - stdin: { text: "--help\n" }
then:
  - stdout_contains: "Usage"
```

When `runner.kind: gherkin` or `runner.framework: cucumber` is selected, ShipFlow generates `.feature` files plus Cucumber step definitions under `.gen/cucumber/` and executes them with `npx cucumber-js`.

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
| `auth` | Optional bearer auth injected from env or inline token |

#### API Assertions

```yaml
- status: 200                                                # HTTP status
- header_equals: { name: "x-request-id", equals: "abc" }    # exact header
- header_matches: { name: "content-type", regex: "json" }    # regex header
- header_present: { name: "x-trace-id" }                     # required header
- header_absent: { name: "x-internal" }                      # forbidden header
- body_contains: "success"                                    # raw body search
- body_not_contains: "stack trace"                            # negative body check
- json_equals: { path: "$[0].name", equals: "Alice" }        # JSON value
- json_matches: { path: "$.status", regex: "active" }        # JSON regex
- json_count: { path: "$.items", count: 5 }                  # array length
- json_has: { path: "$.meta" }                               # field exists
- json_absent: { path: "$.debug" }                           # field absent
- json_type: { path: "$.items", type: "array" }              # JSON type
- json_array_includes: { path: "$.items", equals: { id: 1 } }
- json_schema:
    path: "$"
    schema:
      type: object
      required: [id, name]
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
seed_sql: |
  CREATE TABLE IF NOT EXISTS users (name TEXT, email TEXT);
  INSERT INTO users VALUES ('Alice', 'alice@test.com');
before_query: "SELECT name FROM users"
before_assert:
  - row_count: 1
action_sql: "UPDATE users SET email = 'alice@prod.test' WHERE name = 'Alice'"
query: "SELECT name, email FROM users"
assert:
  - row_count: 1
  - cell_equals: { row: 0, column: name, equals: "Alice" }
  - cell_matches: { row: 0, column: email, matches: "@prod\\.test$" }
  - column_contains: { column: name, value: "Alice" }
after_query: "SELECT email FROM users"
after_assert:
  - row_equals: { row: 0, equals: { email: "alice@prod.test" } }
cleanup_sql: "DELETE FROM users WHERE name = 'Alice'"
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
  profile: smoke
  thresholds:
    http_req_duration_avg: 150
    http_req_duration_p95: 200
    http_req_failed: 0.01
    checks_rate: 0.99
  vus: 50
  duration: 30s
  ramp_up: 10s
```

Requires `k6` installed. Runs during `shipflow verify`; missing `k6` is a failure, not a skip.

### Technical Checks — `vp/technical/*.yml`

Verify repository-level technical constraints: framework selection, architecture boundaries, CI workflows, infrastructure files, SaaS/tooling declarations, and browser/mobile test services.

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

#### Categories

`framework`, `architecture`, `infrastructure`, `saas`, `ci`, `testing`, `mobile`, `web`, `other`

#### Runners

`custom` uses the built-in repo inspection engine.

`archtest` is for architecture-oriented checks; use it when you want to enforce layering or boundary rules with assertions such as forbidden imports.

Typical `runner.framework` values: `dependency-cruiser`, `tsarch`, `madge`, `eslint-plugin-boundaries`.

Example architecture rule with `tsarch`:

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
  - imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/**", "react"] }
  - no_circular_dependencies: { files: "src/**/*.ts", tsconfig: "tsconfig.json" }
```

Canonical example:

`examples/todo-app/vp/technical/framework-stack.yml` and `examples/todo-app/vp/technical/api-protocol.yml` show the committed technical verification style used by the public example.

Technical checks compile to `.gen/technical/*.runner.mjs`. `runner.framework: custom` uses ShipFlow's built-in repo assertion engine. `dependency-cruiser`, `tsarch`, `madge`, and `eslint-plugin-boundaries` generate specialized technical backend execution inside the normal implementation loop.

#### Technical Assertions

```yaml
- path_exists: { path: "Dockerfile" }
- path_absent: { path: "docker-compose.yml" }
- file_contains: { path: ".github/workflows/ci.yml", text: "playwright install" }
- file_not_contains: { path: "package.json", text: "\"express\"" }
- json_has: { path: "package.json", query: "$.scripts.test" }
- json_equals: { path: "package.json", query: "$.type", equals: "module" }
- json_matches: { path: "package.json", query: "$.packageManager", matches: "^pnpm@" }
- dependency_present: { name: "next", section: dependencies }
- dependency_absent: { name: "express", section: all }
- dependency_version_matches: { name: "next", section: dependencies, matches: "^14\\." }
- script_present: { name: "build" }
- script_contains: { name: "test:e2e", text: "playwright" }
- github_action_uses: { workflow: ".github/workflows/ci.yml", action: "actions/setup-node@v4" }
- glob_count: { glob: ".github/workflows/*.yml", equals: 2 }
- glob_count_gte: { glob: ".github/workflows/*.yml", gte: 1 }
- graphql_surface_present: { files: "**/*", endpoint: "/graphql" }
- graphql_surface_absent: { files: "**/*", endpoint: "/graphql" }
- rest_api_present: { files: "**/*", path_prefix: "/api/" }
- rest_api_absent: { files: "**/*", path_prefix: "/api/", allow_paths: ["/graphql", "/api/graphql"] }
- imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/**", "react"] }
- imports_allowed_only_from: { files: "src/domain/**/*.ts", patterns: ["@/domain", "@/shared"] }
- no_circular_dependencies: { files: "src/**/*.ts", tsconfig: "tsconfig.json" }
- layer_dependencies:
    layers:
      - { name: ui, files: "src/ui/**/*.ts", may_import: ["application", "shared"] }
      - { name: application, files: "src/application/**/*.ts", may_import: ["domain", "shared"] }
- command_succeeds: { command: "terraform validate", cwd: "infra" }
```

Protocol-oriented technical checks let you enforce stack direction, not just package presence. For example, a GraphQL-first service can require a declared GraphQL surface and forbid parallel REST routes, while a REST-only service can require `/api/*` routes and forbid GraphQL server surfaces.

### Local Draft Workflow

```bash
shipflow map "todo app with login"
shipflow draft "todo app with login"
shipflow draft "todo app with login" --write
shipflow doctor
shipflow lint
shipflow gen
```

Recommended usage:
1. `shipflow map "..."` to inspect the current repo surface in the context of the requested scope.
2. `shipflow draft "..."` to see the understood coverage, request-driven gaps, ambiguities, and proposed starter files.
3. `shipflow draft "..." --write` to write starter files for the highest-confidence gaps.
4. Review/edit the VP files.
5. Run `shipflow doctor`, then `shipflow lint`, then `shipflow gen`.

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

Reads all `vp/**/*.yml` files, validates schemas, generates Playwright tests into `.gen/playwright/`, Cucumber artifacts into `.gen/cucumber/`, k6 scripts into `.gen/k6/`, technical runners into `.gen/technical/`, and creates `.gen/vp.lock.json` plus `.gen/manifest.json`.

### Run verification

```bash
shipflow verify
```

1. Validates the lock (VP unchanged since `gen`)
2. Evaluates OPA policies (if present)
3. Runs generated Playwright tests and writes per-type evidence files
4. Runs generated technical backend runners when present and writes `evidence/technical.json`
5. Runs k6 NFR scripts when present. Missing `k6` is treated as a verification failure and writes `evidence/load.json`
6. Writes aggregate `evidence/run.json`
7. Exits 0 if all tests pass

`shipflow implement` also writes `evidence/implement.json` with the latest loop result so you can inspect the last implementation pass.
If recent implementation history is available, `shipflow status` can summarize it, but that is secondary to the normal draft and implement flow.
By default, implementation writes are allowed under the configured `srcDir`. When `vp/technical/*.yml` references repo-level files such as `package.json`, `.github/workflows/*.yml`, or infrastructure paths, ShipFlow also allows those targets automatically. For extra cases, set `impl.writeRoots` in `shipflow.json`.

### Check status

```bash
shipflow status
```

Shows VP file counts, generated test counts, last run results, and aggregated implementation history.

## Anti-Cheat

ShipFlow enforces separation between verification and implementation:

| Protected | Contents | Who writes |
|---|---|---|
| `vp/` | Verifications (YAML) | Definition phase only |
| `.gen/` | Generated tests, manifest, lock | `shipflow gen` |
| `evidence/` | Test results | `shipflow verify` |

Hooks enforce this automatically per platform:
- **Claude Code** — PreToolUse blocks Write/Edit to protected paths, Stop runs verify before completion
- **Codex CLI** — Sandbox exec policy rules restrict protected paths
- **Gemini CLI** — BeforeTool hooks block writes to protected paths
- **Kiro CLI** — PreToolUse hooks block writes (exit code 2) to protected paths
