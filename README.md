# ShipFlow

**Tell the AI what to build. It writes verifications, generates tests, implements the code, and loops until everything passes.**

ShipFlow is a verification-first framework for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). You describe your app in plain language. The AI drafts executable verifications, generates Playwright tests from them, writes all the application code, and loops until every test is green.

```
 You describe           AI drafts              AI generates           AI builds & loops
"a calculator"  -->  vp/**/*.yml  -->  .gen/playwright/*.ts  -->  src/**  -->  all tests pass
```

## How It Works

### Phase 1 — Verification (`/shipflow-verifications`)

You describe what you want. The AI immediately drafts verifications — no interview, no spec documents. You review and refine.

```yaml
# vp/ui/add-numbers.yml
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

The AI **cannot cheat** — hooks block any modification to `vp/`, `.gen/`, and `evidence/` during implementation.

## Quick Start

```bash
git clone <shipflow-repo-url>
cd ShipFlow
./install.sh
```

Restart Claude Code, then in any project:

```
/shipflow-verifications a calculator app
```

The AI drafts verifications. Review them, then:

```
/shipflow-impl
```

The AI builds the app and loops until all verifications pass.

To scaffold a project with hooks and CLAUDE.md:

```bash
./install.sh /path/to/your-project
```

## Verification Types

ShipFlow supports four types of verifications. All compile to Playwright tests.

### UI Checks — `vp/ui/*.yml`

Verify what users see and interact with in the browser.

```yaml
id: add-item
title: User can add an item
severity: blocker
setup: login-as-user          # optional — references vp/ui/_fixtures/
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

**Flow steps**: `open`, `click`, `fill`, `select`, `hover`, `wait_for`

**Assertions**: `text_equals`, `text_matches`, `visible`, `hidden`, `url_matches`, `count`

**Locators**: `testid`, `label`, `role` + `name`

### Behavior Checks — `vp/behavior/*.yml`

Verify business logic scenarios with Given/When/Then. Same flow steps and assertions as UI checks.

```yaml
id: checkout-flow
feature: Shopping Cart
scenario: User adds item and checks out
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
given:
  - open: /products
  - click: { testid: add-to-cart }
when:
  - click: { name: "Checkout" }
  - fill: { label: "Card Number", value: "4111111111111111" }
  - click: { name: "Pay" }
then:
  - url_matches: { regex: "/confirmation" }
  - visible: { testid: success-message }
```

### API Checks — `vp/api/*.yml`

Verify HTTP endpoints. No browser needed.

```yaml
id: list-users
title: GET /api/users returns user list
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

**Request**: `method` (GET/POST/PUT/PATCH/DELETE), `path`, `headers`, `body`, `body_json`

**Assertions**: `status`, `header_equals`, `header_matches`, `body_contains`, `json_equals`, `json_matches`, `json_count`

### DB Checks — `vp/db/*.yml`

Verify database state. Supports SQLite and PostgreSQL.

```yaml
id: users-seeded
title: Users table has expected seed data
severity: blocker
app:
  kind: db
  engine: sqlite
  connection: ./test.db
setup_sql: |
  INSERT INTO users (name, email) VALUES ('Alice', 'alice@test.com');
query: "SELECT name, email FROM users"
assert:
  - row_count: 1
  - cell_equals: { row: 0, column: name, equals: "Alice" }
```

**Assertions**: `row_count`, `cell_equals`, `cell_matches`, `column_contains`

### Fixtures — `vp/ui/_fixtures/*.yml`

Reusable setup flows (login, etc.) for UI and behavior checks via `setup:`.

```yaml
id: login-as-user
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /login
  - fill: { label: Email, value: "test@example.com" }
  - fill: { label: Password, value: "testpass" }
  - click: { name: "Sign in" }
```

## Project Structure

```
your-app/
├── vp/                          # Verifications (human + AI)
│   ├── ui/*.yml
│   ├── behavior/*.yml
│   ├── api/*.yml
│   ├── db/*.yml
│   └── ui/_fixtures/*.yml
├── .gen/                        # Generated tests (do not edit)
│   ├── playwright/*.spec.ts
│   └── vp.lock.json
├── evidence/                    # Test results (do not edit)
│   └── run.json
├── src/                         # Application code (AI writes this)
└── shipflow.json                # Config
```

## CLI

```bash
shipflow gen       # vp/ → .gen/playwright/*.spec.ts + vp.lock.json
shipflow verify    # Run tests → evidence/run.json, exit 0 if all pass
```

## Anti-Cheat

During implementation, hooks enforce:

- **PreToolUse** blocks Write/Edit to `vp/`, `.gen/`, `evidence/`
- **Stop** hook runs `shipflow verify` — blocks completion if tests fail
- **VP lock** (SHA-256) detects any tampering between `gen` and `verify`

## Configuration

```json
{
  "impl": {
    "srcDir": "src",
    "context": "Node.js HTTP server, no frameworks"
  }
}
```

## CI

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

## Requirements

- Node.js 18+
- Claude Code with plugin support

## License

MIT
