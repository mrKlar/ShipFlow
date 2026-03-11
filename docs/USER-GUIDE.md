# ShipFlow User Guide

## What is ShipFlow?

ShipFlow is a verification-first shipping framework. You define what must be observably true when the work is done, you and/or the AI turn that into a verification pack, ShipFlow compiles it into runnable tests, and the AI implements against that locked pack.

The verification pack records required checks and constraints, not a prose description of the app. That can now include visible UI contracts, locked visual baselines, business-domain objects and data objects, runtime and stack boundaries, and app-shape-aware bundles for frontend apps, fullstack apps, REST backend services, and CLI/TUI products.

```
vp/**/*.yml  →  shipflow gen  →  .gen/playwright/*.test.ts + .gen/cucumber/** + .gen/domain/*.runner.mjs + .gen/k6/*.js + .gen/technical/*.runner.mjs  →  shipflow verify  →  evidence/*.json
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
   - **Gemini CLI** — extension + BeforeTool write/shell guard hooks
   - **Kiro CLI** — skills + steering context + project PreToolUse write/shell guards

Restart Claude Code after installing.

### Project setup

In any project directory:

```bash
shipflow init
```

This creates `vp/` directories, `shipflow.json`, `.gitignore`, and the project-local files for the selected platform(s), such as `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `KIRO.md`, `.claude/hooks.json`, or `.gemini/settings.json`.
By default, `shipflow init` scaffolds the files for the currently detected CLI. Use explicit flags when you want another surface or multiple surfaces.

For the normal greenfield flow, `shipflow implement` bootstraps a local verification runtime under `.shipflow/runtime/` when possible, including JS packages such as `@playwright/test` or `@cucumber/cucumber`, a local Playwright browser runtime, and supported native backends such as `k6` or `opa`.
Some system-level tools may still be required depending on your pack. SQLite checks can use `sqlite3` when it is installed, or fall back to Node's `node:sqlite` runtime on newer Node versions. PostgreSQL checks still require `psql`.
On greenfield drafts, ShipFlow can also write technical starters that pin that initial verification environment into the pack, so runtime drift is reviewed as a pack change rather than discovered later as a flaky implementation failure.

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
/shipflow:draft a todo app with login
```

Use that first pass as the draft flow. Tighten it, add missing checks, remove weak ones, then:

```
/shipflow:implement
```

Debug commands are also available:

```
/shipflow:map
/shipflow:doctor
/shipflow:lint
/shipflow:gen
/shipflow:verify
/shipflow:status
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

Debug skills are also available:

```
$shipflow-map
$shipflow-doctor
$shipflow-lint
$shipflow-gen
$shipflow-verify
$shipflow-status
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

Debug commands are also available:

```
/shipflow:map
/shipflow:doctor
/shipflow:lint
/shipflow:gen
/shipflow:verify
/shipflow:status
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
shipflow approve-visual
shipflow verify
shipflow status
shipflow implement-once
```

## Configuration

ShipFlow reads `shipflow.json` from the project root.

Minimal example:

```json
{
  "draft": {
    "provider": "local",
    "aiProvider": "auto"
  },
  "impl": {
    "provider": "auto",
    "srcDir": "src",
    "historyLimit": 50
  }
}
```

Useful fields:

- `draft.provider`: keep `local` for deterministic local drafting, or override explicitly.
- `draft.aiProvider`: choose which CLI/provider refines draft proposals when AI refinement is enabled.
- `impl.provider`: `auto` resolves to the active CLI when possible.
- `impl.srcDir`: main implementation root.
- `impl.writeRoots`: extra repo-level paths allowed during implementation, such as `.github/workflows` or `infra`.
- `impl.context`: extra project context passed into implementation.
- `impl.autoBootstrap`: whether ShipFlow should bootstrap its local verification runtime under `.shipflow/runtime/`.

## App Shapes ShipFlow Understands

ShipFlow drafts better packs when it understands the shape of the product, not just the words in the prompt.

- `frontend-web`: browser UI with no backend surface
- `fullstack-web-stateless`: browser UI plus API, without persistence
- `fullstack-web-stateful`: browser UI plus API plus persistence
- `rest-service`: backend service behind a REST API, including database-backed services and multi-API orchestration services
- `api-service-stateless` / `api-service-stateful`: non-REST or protocol-agnostic API services
- `cli-tui-stateless` / `cli-tui-stateful`: terminal-first applications with or without persistence

That archetype drives the default verification bundle ShipFlow keeps in scope during draft. A REST backend service, for example, is treated as a real product boundary, not just "one endpoint exists." ShipFlow can keep `behavior`, `domain`, `api`, and `technical` checks in play by default, then add `database` automatically when persistence is detected.

## Writing Verifications

### UI Checks — `vp/ui/*.yml`

One file per behavior or visible contract. Each check defines a flow (user actions), assertions (expected results), and optionally a strict `visual` contract for layout, placement, styles, and snapshots.

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

#### Visual UI Contracts

When you need to lock what the interface actually looks like, add named `targets` plus a `visual` block. This is how ShipFlow moves from "the element exists" to "the layout, style, and rendered result stay correct."

```yaml
id: cart-summary-visual
title: Cart summary stays visually correct
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /cart
targets:
  summary: { testid: cart-summary }
  total: { testid: cart-total }
  cta: { testid: checkout-button }
assert:
  - visible: { testid: cart-summary }
visual:
  context:
    viewport: { width: 1440, height: 900 }
    color_scheme: light
    reduced_motion: true
    locale: en-US
    timezone: UTC
    wait_for_fonts: true
  assertions:
    - aligned:
        items: [total, cta]
        axis: left
        tolerance_px: 4
    - spacing:
        from: total
        to: cta
        axis: y
        min_px: 16
        max_px: 24
    - css_equals:
        target: cta
        property: border-radius
        equals: "12px"
  snapshots:
    - name: cart-summary.desktop.light
      target: summary
      max_diff_ratio: 0.002
      max_diff_pixels: 120
      per_pixel_threshold: 0.1
```

Supported visual assertions:

- `aligned`
- `spacing`
- `size_range`
- `inside`
- `not_overlapping`
- `css_equals`
- `css_matches`
- `token_resolves`

Snapshots are intentionally explicit. Generate them with `shipflow gen`, then approve the intended baseline once:

```bash
shipflow approve-visual
```

That writes locked baselines under `vp/ui/_baselines/<check-id>/`. During `shipflow verify`, ShipFlow writes `expected.png`, `actual.png`, `diff.png`, and metrics under `evidence/visual/<check-id>/...` so UI regressions are reviewable instead of hand-waved.

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

### Business Domain Checks — `vp/domain/*.yml`

Business-domain checks define the product's business objects before the implementation hardens them into tables, JSON payloads, DTOs, caches, or denormalized views.

This is where you say:
- which business objects exist
- which identities and references matter
- which invariants must hold
- which read and write access patterns the implementation must support
- which technical data objects must exist after data engineering

The point is not to force a naive 1:1 mapping from business objects to tables or API payloads. The point is to make the business truth explicit, then lock the required translation into technical data objects for persistence, reads, writes, and exchanges.

```yaml
id: domain-todo
title: Todo business object and data engineering stay explicit
severity: blocker
object:
  name: Todo
  kind: entity
description: Todos can be created, completed, and filtered by status.
identity:
  fields: [id]
  strategy: surrogate
attributes:
  - { name: id, type: number, required: true, mutable: false }
  - { name: title, type: string, required: true, mutable: true }
  - { name: status, type: enum, values: [active, completed], required: true, mutable: true }
references: []
invariants:
  - Todo title must be non-empty.
  - Todo status is either active or completed.
access_patterns:
  reads:
    - { name: list_todos_by_status, fields: [id, title, status] }
  writes:
    - { name: create_todo, fields: [title] }
    - { name: complete_todo, fields: [id, status] }
data_engineering:
  storage:
    canonical_model: todo
    allow_denormalized_copies: true
    write_models:
      - { name: todo_record, fields: [id, title, status] }
    read_models:
      - { name: todo_list_item, fields: [id, title, status] }
  exchange:
    inbound:
      - { name: create_todo_command, fields: [title] }
      - { name: complete_todo_command, fields: [id] }
    outbound:
      - { name: todo_response, fields: [id, title, status] }
  guidance:
    - Split the business object from technical read/write/exchange models when it improves the system.
assert:
  - data_engineering_present: { sections: [storage, exchange] }
  - read_model_defined: { name: todo_list_item }
  - write_model_defined: { name: todo_record }
  - exchange_model_defined: { direction: outbound, name: todo_response }
```

#### Domain Fields

| Field | Purpose |
|---|---|
| `object` | Names the business object and its kind (`entity`, `aggregate`, `value_object`, `event`) |
| `identity` | Declares the stable identity strategy and identity fields |
| `attributes` | Declares the core business fields |
| `references` | Declares links to other business objects |
| `invariants` | Declares what must remain true in the business domain |
| `access_patterns` | Declares the reads and writes the system must support |
| `data_engineering` | Declares the required translation into technical data objects |
| `assert` | Makes the required data-engineering outputs executable |

#### Data Engineering

`data_engineering` is the bridge between business truth and technical implementation.

- `storage.canonical_model` names the primary persisted representation.
- `storage.write_models` names the technical write-side data objects.
- `storage.read_models` names the technical read-side data objects.
- `exchange.inbound` names inbound command or request shapes.
- `exchange.outbound` names outbound response or event shapes.
- `guidance` records deliberate engineering choices, such as allowing denormalized copies or separating write and read models.

This is the layer that lets the pack say "the business object is Todo" without forcing the code to use the exact same shape everywhere.

Business-domain checks generate `.gen/domain/*.runner.mjs` and verify that the contract is internally coherent and that the required technical data objects are explicitly named.

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

For greenfield repos, ShipFlow can propose these by default as part of the first technical boundary. Typical starters include:
- `vp/technical/runtime-environment.yml` to pin the verification runtime that ShipFlow observed when the pack was drafted, such as `node --version` and the exact `packageManager` declaration.
- `vp/technical/framework-stack.yml` to pin declared framework/tooling choices and their exact dependency specs from `package.json`.
- `vp/technical/ui-component-library.yml` when the product shape implies a UI but the repo has no established design system yet. ShipFlow defaults to widely used open-source design-system libraries rather than drifting into an accidental local UI kit.

That means ShipFlow can guide the stack toward proven defaults:
- `Chakra UI` for marketing-style React / Next surfaces
- `MUI` for general product UI on React / Next
- `Ant Design` for admin or data-heavy React / Next apps
- `Vuetify`, `Angular Material`, or `Skeleton` for their respective ecosystems

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
- json_matches: { path: "package.json", query: "$.packageManager", matches: "^pnpm@9\\.0\\.0$" }
- dependency_present: { name: "next", section: dependencies }
- dependency_absent: { name: "express", section: all }
- dependency_version_matches: { name: "next", section: dependencies, matches: "^\\^14\\.2\\.0$" }
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
- command_stdout_contains: { command: "node --version", text: "v22.22.1" }
```

Protocol-oriented technical checks let you enforce stack direction, not just package presence. For example, a GraphQL-first service can require a declared GraphQL surface and forbid parallel REST routes, while a REST-only service can require `/api/*` routes and forbid GraphQL server surfaces.
They can also pin the runtime assumptions that make the rest of the pack trustworthy, especially when native addons or Node-version-sensitive tooling are involved. For backend services that call multiple upstream APIs, this is where you make the execution environment and client stack explicit instead of letting it fail later as "some flaky integration issue."

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
2. `shipflow draft "..."` to see the understood coverage, inferred app archetype, request-driven gaps, ambiguities, and proposed starter files.
3. `shipflow draft "..." --write` to write starter files for the highest-confidence gaps. On a new project, this can include business-domain starters such as `vp/domain/*.yml` plus technical starters such as `vp/technical/runtime-environment.yml`, `vp/technical/framework-stack.yml`, and `vp/technical/ui-component-library.yml`.
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

Reads all `vp/**/*.yml` files, validates schemas, generates Playwright tests into `.gen/playwright/`, Cucumber artifacts into `.gen/cucumber/`, business-domain runners into `.gen/domain/`, k6 scripts into `.gen/k6/`, technical runners into `.gen/technical/`, writes `.gen/manifest.json`, and then creates `.gen/vp.lock.json` covering both `vp/` and `.gen/`.

For visual UI contracts, `shipflow gen` also wires snapshot comparison into the generated Playwright tests. Approved baselines stay under `vp/ui/_baselines/`, which means they are locked as part of the pack rather than treated as disposable test output.

### Approve visual baselines

```bash
shipflow approve-visual [check-id|vp/ui/file.yml]
```

Captures or refreshes the approved baseline images for visual UI checks after generation. This is an explicit review step, not something `verify` or `implement` will do automatically.

### Run verification

```bash
shipflow verify
```

1. Validates the cryptographic lock (`vp/` and `.gen/` unchanged since `gen`)
2. Evaluates OPA policies (if present)
3. Runs generated Playwright tests and writes per-type evidence files
4. Writes visual diff artifacts under `evidence/visual/` when UI visual contracts are present
5. Runs generated business-domain runners when present and writes `evidence/domain.json`
6. Runs generated technical backend runners when present and writes `evidence/technical.json`
7. Runs k6 NFR scripts when present. Missing `k6` after bootstrap is treated as a verification failure and writes `evidence/load.json`
8. Writes aggregate `evidence/run.json`
9. Exits 0 if all tests pass

`shipflow implement` also writes `evidence/implement.json` as it moves through the loop, so you can inspect the current stage while it is running and the latest result afterward.
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
- **Claude Code** — PreToolUse blocks Write/Edit to protected paths, blocks ShipFlow self-introspection Bash detours during draft, and Stop runs verify before completion
- **Codex CLI** — Sandbox exec policy rules restrict protected paths
- **Gemini CLI** — BeforeTool hooks block writes to protected paths and shell detours that inspect installed ShipFlow internals
- **Kiro CLI** — PreToolUse hooks block writes (exit code 2) to protected paths and shell detours that inspect installed ShipFlow internals
