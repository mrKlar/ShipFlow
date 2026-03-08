# ShipFlow

**Tell the AI what to build. It writes verifications, generates tests, implements the code, and loops until everything passes.**

ShipFlow is a verification-first framework for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). You describe your app in plain language. The AI drafts executable verifications (YAML), generates Playwright tests from them, writes all the application code, and keeps looping until every test is green. No manual coding required.

```
 You say              AI drafts                AI generates         AI builds & loops
"a calculator"  -->  vp/**/*.yml  -->  .gen/playwright/*.ts  -->  src/**  -->  All tests pass
                     (ui, behavior, api, db)
```

## How It Works

ShipFlow has two phases, both driven by AI:

### Phase 1 — Verification (`/shipflow-verifications`)

You describe what you want. The AI immediately drafts verifications — no interview, no spec documents. You review and refine.

```yaml
# vp/ui/add-numbers.yml — drafted by AI, refined by you
id: add-numbers
title: Adding two numbers shows the correct result
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /
  - click: { testid: btn-2 }
  - click: { testid: btn-plus }
  - click: { testid: btn-3 }
  - click: { testid: btn-equals }
assert:
  - text_equals: { testid: display, equals: "5" }
```

### Phase 2 — Implementation (`/shipflow-impl`)

Fully autonomous. The AI reads the verifications, generates Playwright tests, writes all application code, runs the tests, reads failures, fixes the code, and repeats until every test passes.

```
Read VP  →  Generate tests  →  Implement  →  Verify  →  Pass? Done.
                                    ↑                      ↓
                                    └──── Fix & retry ─────┘
```

The AI **cannot cheat** — hooks block any modification to `vp/`, `.gen/`, and `evidence/` during implementation. If the code doesn't pass the tests, the only option is to fix the code.

## Quick Start

### Install ShipFlow

```bash
git clone https://github.com/anthropics/ShipFlow.git
cd ShipFlow
./install.sh
```

This registers ShipFlow as a Claude Code plugin. Restart Claude Code after installing.

### Use It

Open any project in Claude Code and run:

```
/shipflow-verifications a calculator app
```

The AI drafts verifications immediately. Review them, then:

```
/shipflow-impl
```

The AI builds the entire app and loops until all verifications pass.

### Setup a Project (optional)

For project-specific hooks and CLAUDE.md:

```bash
./install.sh /path/to/your-project
```

This creates:
- `CLAUDE.md` — instructions for the AI
- `.claude/hooks.json` — anti-cheat hooks
- `vp/ui/` — directory for your verifications

## Verification Types

ShipFlow supports four types of verifications. All generate Playwright tests.

### UI Checks — `vp/ui/*.yml`

Verify what users see and interact with in the browser.

```yaml
id: add-item
title: User can add an item
severity: blocker
setup: login-as-user          # optional fixture reference
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /items
  - fill: { testid: new-item, value: "Buy milk" }
  - click: { name: "Add" }
assert:
  - text_equals: { testid: item-last, equals: "Buy milk" }
  - count: { testid: item, equals: 1 }
```

**Flow steps**: `open`, `click` (name/testid/role), `fill` (testid/label + value), `select` (label/testid + value), `hover` (role/testid), `wait_for` (ms).

**Assertions**: `text_equals`, `text_matches`, `visible`, `hidden`, `url_matches`, `count`.

**Locators**: `testid` → `getByTestId()`, `label` → `getByLabel()`, `role` + `name` → `getByRole()`.

### Behavior Checks — `vp/behavior/*.yml`

Verify business logic scenarios with Given/When/Then structure. Uses the same flow steps and assertions as UI checks.

```yaml
id: checkout-flow
feature: Shopping Cart
scenario: User adds item and checks out
severity: blocker
setup: login-as-user
app:
  kind: web
  base_url: http://localhost:3000
given:
  - open: /products
  - click: { testid: add-to-cart }
when:
  - open: /cart
  - click: { name: "Checkout" }
  - fill: { label: "Card Number", value: "4111111111111111" }
  - click: { name: "Pay" }
then:
  - url_matches: { regex: "/confirmation" }
  - visible: { testid: success-message }
```

### API Checks — `vp/api/*.yml`

Verify HTTP endpoints. Generated tests use Playwright's `request` API context (no browser needed).

```yaml
id: list-users
title: GET /api/users returns user list
severity: blocker
app:
  kind: api
  base_url: http://localhost:3000
request:
  method: GET                  # GET, POST, PUT, PATCH, DELETE
  path: /api/users
  headers:                     # optional
    Authorization: "Bearer test-token"
assert:
  - status: 200
  - header_matches: { name: content-type, matches: "application/json" }
  - json_count: { path: "$", count: 3 }
  - json_equals: { path: "$[0].name", equals: "Alice" }
```

**Request options**: `method`, `path`, `headers`, `body` (string), `body_json` (object).

**Assertions**: `status`, `header_equals`, `header_matches`, `body_contains`, `json_equals`, `json_matches`, `json_count`.

JSON paths use `$` for the response body root: `$[0].name` → `body[0].name`.

### DB Checks — `vp/db/*.yml`

Verify database state. Supports SQLite and PostgreSQL.

```yaml
id: users-seeded
title: Users table has expected seed data
severity: blocker
app:
  kind: db
  engine: sqlite               # sqlite or postgresql
  connection: ./test.db        # file path or connection string
setup_sql: |                   # optional — runs before the query
  INSERT INTO users (name, email) VALUES ('Alice', 'alice@test.com');
query: "SELECT name, email FROM users"
assert:
  - row_count: 1
  - cell_equals: { row: 0, column: name, equals: "Alice" }
  - cell_matches: { row: 0, column: email, matches: "@test\\.com$" }
  - column_contains: { column: name, value: "Alice" }
```

**Assertions**: `row_count`, `cell_equals`, `cell_matches`, `column_contains`.

### Fixtures — `vp/ui/_fixtures/*.yml`

Reusable setup flows (login, navigation, etc.) referenced by `setup:` in UI and behavior checks.

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
```

## CLI Commands

```bash
shipflow gen       # Compile vp/ → .gen/playwright/*.spec.ts + vp.lock.json
shipflow verify    # Run tests → evidence/run.json, exit 0 if all pass
```

## Anti-Cheat

ShipFlow enforces a strict separation: the implementer cannot modify verifications, generated tests, or evidence.

| Protected path | What it contains | Who writes it |
|---|---|---|
| `vp/` | Verification pack (YAML) | Human + AI (spec phase only) |
| `.gen/` | Generated Playwright tests | `shipflow gen` |
| `evidence/` | Test results | `shipflow verify` |

During implementation, Claude Code hooks block any `Write` or `Edit` to these paths. A `Stop` hook runs `shipflow verify` before the AI can finish — if tests fail, it keeps working.

## Project Structure

```
your-app/
├── vp/                          # You define these
│   ├── ui/
│   │   ├── feature-a.yml
│   │   ├── feature-b.yml
│   │   └── _fixtures/
│   │       └── auth.yml
│   ├── behavior/
│   │   └── checkout.yml
│   ├── api/
│   │   └── users.yml
│   └── db/
│       └── seed-data.yml
├── .gen/                        # ShipFlow generates these
│   ├── playwright/
│   │   ├── vp_ui_feature-a.spec.ts
│   │   ├── vp_behavior_checkout.spec.ts
│   │   ├── vp_api_users.spec.ts
│   │   └── vp_db_seed-data.spec.ts
│   └── vp.lock.json
├── evidence/                    # ShipFlow writes these
│   └── run.json
├── src/                         # AI implements this
│   └── ...
└── shipflow.json                # Project config
```

## Configuration

`shipflow.json` at your project root:

```json
{
  "impl": {
    "srcDir": "src",
    "context": "Node.js HTTP server, no frameworks, inline CSS/JS"
  }
}
```

| Field | Default | Description |
|---|---|---|
| `impl.srcDir` | `"src"` | Where the AI writes application code |
| `impl.context` | — | Tech stack guidance for the AI |

## CI Integration

```yaml
# .github/workflows/verify.yml
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

## Requirements

- Node.js 18+
- Claude Code with plugin support
- Playwright (installed automatically via `npx`)

## License

MIT
