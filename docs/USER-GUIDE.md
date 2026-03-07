# ShipFlow User Guide

## What is ShipFlow?

ShipFlow is a verification-first workflow framework. You write **what the app must do** in human-readable YAML files (the Verification Pack). ShipFlow compiles those into executable tests and runs them to produce evidence. The implementer — human or AI agent — never touches the specs or tests.

```
You write         ShipFlow generates       ShipFlow runs
vp/ui/*.yml  -->  .gen/playwright/*.ts -->  evidence/run.json
```

## Installation

### Option A: git submodule (recommended)

```bash
cd your-app-repo
git submodule add <shipflow-repo-url> tools/shipflow
npm install --prefix tools/shipflow
```

Then call ShipFlow via:

```bash
node tools/shipflow/bin/shipflow.js gen
node tools/shipflow/bin/shipflow.js verify
```

Or add convenience scripts to your app's `package.json`:

```json
{
  "scripts": {
    "shipflow:gen": "node tools/shipflow/bin/shipflow.js gen",
    "shipflow:verify": "node tools/shipflow/bin/shipflow.js verify"
  }
}
```

### Option B: copy into your repo

Copy `bin/` and `lib/` from ShipFlow into your project (e.g. under `tools/shipflow/`), then install its dependencies (`js-yaml`, `zod`).

## Project structure

ShipFlow expects these directories in your app repo:

```
your-app/
  vp/                     # Verification Pack (human-written, reviewed)
    ui/
      feature-a.yml
      feature-b.yml
      _fixtures/          # Reusable setup flows
        login.yml
  .gen/                   # Generated tests (do NOT edit)
    playwright/
      vp_ui_feature-a.spec.ts
      vp_ui_feature-b.spec.ts
    vp.lock.json
  evidence/               # Verification results (do NOT edit)
    run.json
```

The only files you write and review are under `vp/`.

## Writing UI checks

Each file in `vp/ui/` defines one check. A check has:

- **id**: unique identifier
- **title**: human-readable description
- **severity**: `blocker` (must pass) or `warn` (advisory)
- **app**: the target application
- **flow**: sequence of user actions
- **assert**: expected outcomes

### Minimal example

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
  - text_equals:
      testid: app-title
      equals: My App
```

### Flow steps

#### open

Navigate to a path (appended to `base_url`).

```yaml
- open: /dashboard
```

#### click

Click an element. Three locator strategies are available:

```yaml
# By accessible role (role defaults to "button")
- click:
    name: Submit

# By explicit role
- click:
    role: link
    name: Home

# By data-testid
- click:
    testid: nav-settings

# By label
- click:
    label: Accept terms

# With regex name matching
- click:
    name: "Delete.*"
    name_regex: true
```

#### fill

Type text into an input.

```yaml
# By data-testid
- fill:
    testid: email-input
    value: user@example.com

# By label
- fill:
    label: Password
    value: secret123

# By role (must specify role explicitly)
- fill:
    role: textbox
    name: Search
    value: shipflow
```

#### select

Pick an option from a dropdown.

```yaml
# By label
- select:
    label: Country
    value: FR

# By data-testid
- select:
    testid: theme-dropdown
    value: dark

# By role
- select:
    role: combobox
    name: Language
    value: en
```

#### hover

Hover over an element (menus, tooltips).

```yaml
# By role (required — no default)
- hover:
    role: button
    name: Menu

# By data-testid
- hover:
    testid: info-icon

# By label
- hover:
    label: Help
```

#### wait_for

Pause for a fixed duration (milliseconds). Defaults to 250ms if `ms` is omitted.

```yaml
- wait_for:
    ms: 500

# Or with default 250ms
- wait_for: {}
```

### Assertions

#### text_equals

Exact text content match by `data-testid`.

```yaml
- text_equals:
    testid: welcome-msg
    equals: Welcome back
```

#### text_matches

Regex text content match by `data-testid`.

```yaml
- text_matches:
    testid: status
    regex: "(active|pending)"
```

#### visible

Assert an element is visible.

```yaml
- visible:
    testid: user-avatar
```

#### hidden

Assert an element is hidden.

```yaml
- hidden:
    testid: empty-state
```

#### url_matches

Assert the current page URL matches a regex.

```yaml
- url_matches:
    regex: "/dashboard"
```

#### count

Assert the number of matching elements.

```yaml
- count:
    testid: todo-item
    equals: 5
```

### Locator strategies

All interaction steps (`click`, `fill`, `select`, `hover`) support three locator strategies. Use exactly one per step:

| Strategy | Fields | Playwright output |
|---|---|---|
| Role | `role`, `name`, `name_regex?` | `page.getByRole(role, { name })` |
| Test ID | `testid` | `page.getByTestId(id)` |
| Label | `label` | `page.getByLabel(label)` |

`click` defaults `role` to `"button"` if only `name` is provided. All other steps require `role` to be explicit.

## Fixtures (reusable setup flows)

Place reusable flows in `vp/ui/_fixtures/`. A fixture has an `id` and a `flow` but no assertions.

```yaml
# vp/ui/_fixtures/login.yml
id: login-as-user
title: Log in as default test user
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /login
  - fill:
      testid: email
      value: test@example.com
  - fill:
      label: Password
      value: testpass
  - click:
      name: Sign in
  - wait_for:
      ms: 300
```

Reference a fixture in a check with the `setup` field:

```yaml
id: dashboard-loads
title: Dashboard loads after login
severity: blocker
setup: login-as-user
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /dashboard
assert:
  - visible:
      testid: dashboard-content
```

The fixture's flow steps are inlined before the check's own flow in the generated test.

## Running ShipFlow

### Step 1: Generate tests

```bash
node tools/shipflow/bin/shipflow.js gen
```

This reads all `vp/ui/*.yml` files, validates them, generates Playwright specs in `.gen/playwright/`, and creates a lock file `.gen/vp.lock.json` that captures the hash of every file in `vp/`.

### Step 2: Run verification

```bash
node tools/shipflow/bin/shipflow.js verify
```

This:
1. Verifies the lock (ensures `vp/` hasn't changed since last `gen`)
2. Runs `npx playwright test .gen/playwright`
3. Writes results to `evidence/run.json`
4. Exits with the Playwright exit code (0 = all pass)

### Prerequisites

Your app repo needs Playwright installed:

```bash
npm install -D @playwright/test
npx playwright install
```

And a `playwright.config.ts` at the repo root. See the example project for a minimal config.

## CI integration

Add ShipFlow to your CI pipeline as a merge gate:

```yaml
# .github/workflows/verify.yml
name: ShipFlow Verify
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run shipflow:gen
      - run: npm run shipflow:verify
```

## AI agent adapter setup (Claude Code)

ShipFlow's anti-cheat invariant: the implementer must not modify `vp/`, `.gen/`, or `evidence/`. When using Claude Code as the implementer, enforce this with hooks.

Create `.claude/hooks.json` in your app repo:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "command": "node tools/shipflow/hooks/block-protected-paths.js"
      }
    ],
    "Stop": [
      {
        "command": "npm run shipflow:gen && npm run shipflow:verify"
      }
    ]
  }
}
```

The `PreToolUse` hook blocks any file edit under protected paths during implementation. The `Stop` hook runs `gen` + `verify` before Claude Code finishes, blocking the stop if tests fail.

## Validation errors

If a YAML file has schema errors, ShipFlow reports them with file path and field location:

```
Validation failed in vp/ui/login.yml:
  severity: Invalid enum value. Expected 'blocker' | 'warn', received 'critical'
  flow.2.click.name: Required
```

## Lock integrity

The lock file `.gen/vp.lock.json` records a SHA-256 hash of every file in `vp/`. If you modify any verification pack file after running `gen`, the `verify` command will fail:

```
Error: Verification pack changed since last generation. Run shipflow gen.
```

This ensures generated tests always match the current specs.
