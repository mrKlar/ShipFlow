# ShipFlow User Guide

## What is ShipFlow?

ShipFlow is a verification-first shipping framework. You define what must be observably true when the work is done, you and/or the AI turn that into a verification pack, ShipFlow compiles it into runnable tests, and the AI implements against that locked pack.

The verification pack records required checks and constraints, not a prose description of the app. It is the durable artifact. The implementation is disposable.

ShipFlow also owns the top-level execution model. The loop, the managed local runtime, and the final success condition belong to ShipFlow itself. Playwright, Cucumber, k6, and the technical/domain backends are execution backends for individual verification slices, not the owners of the overall workflow.

```
vp/**/*.yml  →  shipflow gen  →  .gen/playwright/*.test.ts + .gen/cucumber/** + .gen/domain/*.runner.mjs + .gen/k6/*.js + .gen/technical/*.runner.mjs  →  shipflow verify  →  evidence/*.json
```

The only files you define and edit are under `vp/`. Everything else is generated.

## What ShipFlow Can Lock

ShipFlow is built to define the finished state in executable terms. In practice, that means the pack can lock:

- Visible UI behavior: flows, selectors, rendered text, hidden states, and browser-level user interactions.
- Visual UI contracts: layout, spacing, placement, computed styles, tokens, approved baselines, and screenshot diffs.
- End-to-end behavior: what a real user, API client, or terminal user can actually do from input to observable outcome.
- API contracts: request and response behavior, negative cases, JSON shapes, headers, and authentication expectations.
- Database invariants: before/after state, persisted effects, and no-write-on-failure expectations.
- Business domain contracts: business objects, identities, references, invariants, access patterns, and the data-engineering translation into technical data objects.
- Technical boundaries: runtime pinning, dependency and package-manager constraints, protocols, CI, design-system policy, architecture rules, and required tooling.

For stateful systems, the important distinction is this: ShipFlow does not stop at "the endpoint works" or "the table exists." It can lock the business truth first, then lock the required translation into storage models, read models, write models, and exchange models.

For UI-heavy systems, ShipFlow does not stop at "the element exists." It can lock layout, style, and approved visual output through explicit visual contracts plus snapshot diff evidence.

## App Shapes ShipFlow Understands

ShipFlow drafts better packs when it understands the shape of the product, not just the words in the prompt.

- `frontend-web`: browser UI with no backend surface
- `fullstack-web-stateless`: browser UI plus API, without persistence
- `fullstack-web-stateful`: browser UI plus API plus persistence
- `rest-service`: backend service behind a REST API, including database-backed services and multi-API orchestration services
- `api-service-stateless` / `api-service-stateful`: non-REST or protocol-agnostic API services
- `cli-tui-stateless` / `cli-tui-stateful`: terminal-first applications with or without persistence

That archetype drives the default verification bundle ShipFlow keeps in scope during draft. A `rest-service`, for example, is treated as a real product boundary, not just "one endpoint exists." ShipFlow can keep `behavior`, `domain`, `api`, and `technical` checks in play by default, then add `database` automatically when persistence is detected.

For greenfield UI work, ShipFlow can also propose a mainstream open-source design-system component library when the repo has none yet. The default is to reuse an existing design system if one is present. Otherwise ShipFlow steers toward standard open-source choices instead of inventing a local component kit by accident.

## Setup

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
   - **Claude Code** — plugin + native subagents in `~/.claude/agents`
   - **Codex CLI** — native multi-agent roles in `.codex/agents` + config in `.codex/config.toml` + supporting skills / exec policy rules / global instructions
   - **Gemini CLI** — extension commands + BeforeTool write/shell guard hooks
   - **Kiro CLI** — native custom agents in `~/.kiro/agents` + skills + steering context + write/shell guards

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
On the implementation side, ShipFlow can also apply a deterministic product scaffold before the LLM starts coding, so the agent is not rebuilding the same base stack from scratch on every run.

### Multi-platform

```bash
shipflow init --codex              # OpenAI Codex CLI
shipflow init --gemini             # Google Gemini CLI
shipflow init --kiro               # AWS Kiro CLI
shipflow init --claude --codex     # Multiple platforms
shipflow init --all                # All platforms
```

### Configuration

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
- `impl.scaffold.enabled`: whether ShipFlow may apply a deterministic project scaffold before implementation.
- `impl.scaffold.preset`: explicit scaffold preset to apply.
- `impl.scaffold.force`: whether the scaffold may overwrite existing matching foundation files.

### Deterministic Project Scaffold

ShipFlow can script a stable foundation before the LLM touches product logic:
- package scripts
- base dependencies
- initial directory structure
- entrypoints
- a minimal server/UI shell for the supported stack

That changes the shape of the implementation problem. Instead of spending tokens on boilerplate and dependency guesswork, the agent starts from a stable base and focuses on the pack.

For ShipFlow, that foundation is not just code. A startup scaffold is expected to install the archetype's base verification files under `vp/` as part of the initial foundation. If a stack needs shell, protocol, runtime, architecture, or baseline security checks, those checks belong in the scaffolded pack from the start. ShipFlow does not rely on a separate hidden quality gate outside `vp/`.

You can let ShipFlow infer the scaffold from `impl.context` on an empty repo, or declare it explicitly:

```json
{
  "impl": {
    "scaffold": {
      "enabled": true,
      "preset": "vue-antdv-graphql-sqlite"
    }
  }
}
```

Manual command:

```bash
shipflow scaffold
shipflow scaffold --force
```

Current presets:
- `node-web-rest-sqlite`
- `node-web-graphql-sqlite`
- `node-rest-service-sqlite`
- `vue-antdv-graphql-sqlite`

### Scaffold Plugins

Built-in presets cover the common stacks. Scaffold plugins let you package the foundations your team already trusts and reuse them across repos.

ShipFlow supports two plugin types:
- `startup`: a startup foundation that can run only on a greenfield repo
- `component`: an additive scaffold slice such as `api`, `service`, `database`, `mobile`, `tui`, `ui`, or `worker`

Install a plugin into the current repo:

```bash
shipflow scaffold-plugin install ./my-plugin.zip
shipflow scaffold-plugin list
```

Apply a startup plugin:

```bash
shipflow scaffold --plugin=my-startup-plugin
```

Apply component plugins:

```bash
shipflow scaffold --component=graphql-api --component=sqlite-db
```

You can also declare them in `shipflow.json`:

```json
{
  "impl": {
    "scaffold": {
      "enabled": true,
      "plugin": "my-startup-plugin",
      "components": [
        "graphql-api",
        { "plugin": "sqlite-db" }
      ]
    }
  }
}
```

When a startup or component scaffold is applied, ShipFlow records it in `.shipflow/scaffold-state.json` and feeds the manifest summary/guidance back into the implementation prompt. That way the orchestrator and specialists know what foundation already exists and extend it instead of rebuilding it.

Startup plugins have one extra responsibility: they define the base verification boundary for that archetype. In practice that means a startup plugin should ship `vp/*.yml` files for the truths that are universal to that foundation. Those files become the initial locked pack. App-specific behavior still belongs in the repo's own verification authoring, but archetype-level truths travel with the scaffold plugin itself.

For the archive layout, manifest fields, install-script contract, and contribution workflow, use the dedicated guide: [Scaffold Plugins](./SCAFFOLD-PLUGINS.md).

## Working With ShipFlow

The surface changes by CLI, but the workflow stays the same: draft the pack, tighten it, then run the implementation loop.

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

Claude-specific native implementation surface:
- `shipflow-strategy-lead` subagent for orchestration
- `shipflow-architecture-specialist`, `shipflow-ui-specialist`, `shipflow-api-specialist`, `shipflow-database-specialist`, `shipflow-security-specialist`, `shipflow-technical-specialist` for narrow slices

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

Codex-specific native implementation surface:
- `$shipflow-strategy-lead` for orchestration
- `$shipflow-architecture-specialist`, `$shipflow-ui-specialist`, `$shipflow-api-specialist`, `$shipflow-database-specialist`, `$shipflow-security-specialist`, `$shipflow-technical-specialist` for narrow slices

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

Gemini-specific native implementation surface:
- `/shipflow:strategy-lead` for orchestration
- `/shipflow:architecture-specialist`, `/shipflow:ui-specialist`, `/shipflow:api-specialist`, `/shipflow:database-specialist`, `/shipflow:security-specialist`, `/shipflow:technical-specialist` for narrow slices

### With Kiro CLI

Open your project. Skills and custom agents are installed natively:

```
"let's draft ShipFlow verifications for a todo app with login"
```

Review and iterate with the AI. Then:

```
"run shipflow implement once the draft is ready"
```

Kiro-specific native implementation surface:
- `shipflow-strategy-lead` custom agent for orchestration
- `shipflow-architecture-specialist`, `shipflow-ui-specialist`, `shipflow-api-specialist`, `shipflow-database-specialist`, `shipflow-security-specialist`, `shipflow-technical-specialist` for narrow slices

### Standard Loop

`shipflow implement` is the standard loop. It validates the verification pack, bootstraps the verification runtime, applies a deterministic scaffold when configured or inferred, syncs dependencies when that scaffold changes the repo, generates tests, runs a bounded multi-agent implementation round, verifies, and retries within the configured budget.

The success rule is simple: the run is done only when ShipFlow's own verification phase turns fully green. No specialist, subagent, or runner backend can declare completion on its own.

### Multi-Agent Implementation Strategy

ShipFlow does not keep pouring more repo state into one bloated context window. The implementation loop behaves like a small engineering team with a compact memory.

There are two nested loops:

1. The outer ShipFlow loop: `implement -> verify -> retry until green or budget exhausted`.
2. The inner implementation loop inside each iteration: `strategy lead -> one-shot specialist -> replan -> next one-shot specialist`.

Per implementation iteration:
1. ShipFlow first locks down the runtime and, when needed, applies the deterministic project scaffold.
2. A strategy lead reads the current evidence, recent history, and `.shipflow/implement-thread.json`.
3. It chooses exactly one next micro-task, not a whole batch plan.
4. Exactly one specialist receives that narrow verification slice plus the smallest relevant evidence set.
5. The specialist works in a clean context, writes the smallest useful change it can, and returns immediately when the slice is done or when it has exhausted the straightforward ideas in that slice.
6. The orchestrator replans from the updated workspace and evidence. It may call the same specialist again later, but only for another one-shot slice.
7. When the strategy lead says the current wave is ready, ShipFlow runs `verify`.
8. ShipFlow records what improved, what stayed red, and whether the approach stalled.
9. If the stagnation streak reaches the configured threshold, the next implementation iteration must choose a materially different strategy.

That orchestration sits above the runner layer. A specialist may work on a Playwright-backed UI slice, a Cucumber-backed behavior slice, or a technical runner slice, but the decision to continue, retry, or stop belongs to the ShipFlow loop, not to those tools.

ShipFlow also persists the loop as structured logs:
- `evidence/implement-log.jsonl` — global append-only event stream
- `evidence/implement-log-manifest.json` — current run metadata
- `evidence/agents/*.jsonl` — per-agent high-level events

Those logs are produced by the orchestrator and specialists themselves, so external scripts can follow progress without inventing a second control flow.

Default specialist roles:
- `architecture`
- `ui`
- `api`
- `database`
- `security`
- `technical`

The native delegation surface depends on the CLI:

| CLI | Native surface used by ShipFlow |
|---|---|
| Claude Code | `Task` + installed subagents in `~/.claude/agents` |
| Codex CLI | native multi-agent roles in `.codex/agents` / `.codex/config.toml` + separate Codex runs per slice |
| Gemini CLI | installed extension commands such as `/shipflow:strategy-lead` + separate Gemini runs per slice |
| Kiro CLI | installed custom agents in `~/.kiro/agents` + Kiro subagent delegation |

The loop also keeps three continuity artifacts:
- `evidence/implement.json` — current stage and latest implementation result
- `evidence/implement-history.json` — per-iteration history and provider counts
- `.shipflow/implement-thread.json` — compact memo, active strategy, and stagnation streak

And three structured log artifacts:
- `evidence/implement-log.jsonl`
- `evidence/implement-log-manifest.json`
- `evidence/agents/*.jsonl`

Relevant `shipflow.json` knobs:

```json
{
  "impl": {
    "maxIterations": 50,
    "maxDurationMs": 21600000,
    "stagnationThreshold": 2,
    "team": {
      "enabled": true,
      "maxTasksPerIteration": 6,
      "memoHistory": 8,
      "roles": ["architecture", "ui", "api", "database", "security", "technical"]
    }
  }
}
```

Those defaults mean ShipFlow can keep working for hours on a hard case, but it still has to earn progress. When the loop is not making verifiable headway, it must change tactic instead of reissuing the same fix.

The practical effect of the one-shot model is important:
- ShipFlow does not hand the same broad plan to every specialist.
- Specialists are not expected to grind forever inside one huge context.
- The strategy lead decides the next smallest useful slice after every return.
- The continuity artifact is the compact thread plus structured evidence, not an ever-growing chat transcript.

### Core Commands

```bash
shipflow draft "<user request>"  # Standard flow: co-draft and refine the verification pack
shipflow implement   # Standard flow: validate, generate, implement, verify

# Advanced / debug
shipflow map "<user request>"
shipflow doctor
shipflow lint
shipflow gen
shipflow scaffold
shipflow scaffold-plugin install ./my-plugin.zip
shipflow scaffold-plugin list
shipflow approve-visual
shipflow verify
shipflow status
shipflow implement-once
```

### Draft Workflow

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
4. Review and tighten the `vp/` files.
5. Run `shipflow doctor`, then `shipflow lint`, then `shipflow gen`.

## Authoring the Verification Pack

ShipFlow works best when each file captures one concrete contract. Group the pack by verification type, keep each check observable, and let the type determine the right execution backend.

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

Behavior checks can also express application lifecycle transitions directly. Use `restart_app` when the product truth includes "do something, restart, then re-check". That lifecycle is handled by ShipFlow's managed runtime layer, not by whichever runner backend happens to execute the scenario.

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

Lifecycle example:

```yaml
id: todos-persist-after-restart
feature: Todo API
scenario: Todos persist after restart
severity: blocker
app:
  kind: api
  base_url: http://localhost:3000
given:
  - request:
      method: POST
      path: /api/todos
      body_json: { title: "Alpha", completed: false }
when:
  - restart_app: { wait_for_ready_ms: 10000, wait_after_ms: 200 }
  - request:
      method: GET
      path: /api/todos
then:
  - status: 200
  - json_array_includes:
      path: $
      equals: { title: "Alpha", completed: false }
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
That choice changes the generated artifact shape, not the ownership of the lifecycle. ShipFlow still owns the managed runtime, retry loop, and final verdict.

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

## Generation, Verification, and Evidence

This is the execution side of ShipFlow: compile the pack, approve intended visuals when needed, run verification, and inspect evidence.

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
2. Starts and manages the local runtime when the generated artifact set requires one
3. Evaluates OPA policies (if present)
4. Runs generated verification backends and writes per-type evidence files
5. Writes visual diff artifacts under `evidence/visual/` when UI visual contracts are present
6. Runs generated business-domain runners when present and writes `evidence/domain.json`
7. Runs generated technical backend runners when present and writes `evidence/technical.json`
8. Runs k6 NFR scripts when present. Missing `k6` after bootstrap is treated as a verification failure and writes `evidence/load.json`
9. Writes aggregate `evidence/run.json`
10. Exits 0 only when all blocker verifications pass

That aggregate `evidence/run.json` is the acceptance verdict ShipFlow uses for completion. Example runners, benchmarks, and CLI harnesses should observe it, not re-implement their own hidden success rules.

`shipflow implement` also writes `evidence/implement.json` as it moves through the loop, so you can inspect the current stage while it is running and the latest result afterward.
Structured loop telemetry is written to `evidence/implement-log.jsonl`, `evidence/implement-log-manifest.json`, and `evidence/agents/*.jsonl`.
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
