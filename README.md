# ShipFlow

**Tell the AI what to build. It writes verifications, generates tests, implements the code, and loops until everything passes.**

ShipFlow is a verification-first framework for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). You describe your app in plain language. The AI drafts executable verifications (YAML), generates Playwright tests from them, writes all the application code, and keeps looping until every test is green. No manual coding required.

```
 You say              AI drafts              AI generates         AI builds & loops
"a calculator"  -->  vp/ui/*.yml  -->  .gen/playwright/*.ts  -->  src/**  -->  All tests pass
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

## Verification Pack Reference

Verifications live in `vp/ui/*.yml`. Each file defines one testable behavior.

### Structure

```yaml
id: unique-id
title: What this verifies
severity: blocker        # blocker or warn
setup: fixture-id        # optional — reference to vp/ui/_fixtures/*.yml
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /path
  - click: { name: "Button" }
  - fill: { testid: input, value: "text" }
assert:
  - text_equals: { testid: result, equals: "expected" }
```

### Flow Steps

| Step | Example | What it does |
|---|---|---|
| `open` | `open: /path` | Navigate to URL |
| `click` | `click: { name: "Submit" }` | Click element (role defaults to button) |
| `fill` | `fill: { testid: x, value: "text" }` | Type into input |
| `select` | `select: { label: "Country", value: "FR" }` | Pick dropdown option |
| `hover` | `hover: { role: button, name: "Menu" }` | Hover over element |
| `wait_for` | `wait_for: { ms: 300 }` | Wait (default 250ms) |

### Assertions

| Assertion | Example | What it checks |
|---|---|---|
| `text_equals` | `text_equals: { testid: x, equals: "Hello" }` | Exact text match |
| `text_matches` | `text_matches: { testid: x, regex: "\\d+" }` | Regex text match |
| `visible` | `visible: { testid: x }` | Element is visible |
| `hidden` | `hidden: { testid: x }` | Element exists but hidden |
| `url_matches` | `url_matches: { regex: "/dashboard" }` | URL matches pattern |
| `count` | `count: { testid: x, equals: 3 }` | Number of matching elements |

### Locator Strategies

Every interaction step supports three ways to find elements:

| Strategy | Field | Playwright output |
|---|---|---|
| Role | `role` + `name` | `page.getByRole("button", { name: "Submit" })` |
| Test ID | `testid` | `page.getByTestId("my-input")` |
| Label | `label` | `page.getByLabel("Email")` |

### Fixtures

Reusable setup flows live in `vp/ui/_fixtures/`. Reference them with `setup:`.

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

```yaml
# vp/ui/dashboard.yml
id: dashboard-loads
title: Dashboard shows after login
severity: blocker
setup: login-as-user
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /dashboard
assert:
  - visible: { testid: dashboard-content }
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
│   └── ui/
│       ├── feature-a.yml
│       ├── feature-b.yml
│       └── _fixtures/
│           └── auth.yml
├── .gen/                        # ShipFlow generates these
│   ├── playwright/
│   │   ├── vp_ui_feature-a.spec.ts
│   │   └── vp_ui_feature-b.spec.ts
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
