# ShipFlow - Implementation Plan

## Block 1: Harden the UI vertical ✅

The UI path (YAML -> Playwright) works end-to-end but the DSL is limited.

- [x] Add `fill` step (text input by role/testid)
- [x] Add `select` step (dropdowns)
- [x] Add `hover` step
- [x] Add `visible` / `hidden` assertions
- [x] Add `url_matches` assertion (post-navigation checks)
- [x] Add `count` assertion (number of matching elements)
- [x] Support multi-step flows with named fixtures (login once, reuse session)
- [x] Better error messages on schema validation failure (show file + line)

## Block 2: API verification vertical ✅

Generate HTTP contract tests from VP YAML definitions.

- [x] Define `vp/api/*.yml` format (method, path, headers, body, assertions)
- [x] Zod schema for API checks
- [x] Generator: API YAML -> Playwright API tests (no browser)
- [x] Wire into `shipflow gen` (detect `vp/api/` presence)
- [x] Wire into `shipflow verify` (run API tests alongside UI tests)

## Block 3: Data verification vertical ✅

Run SQL assertions against a database to verify data integrity.

- [x] Define `vp/db/*.yml` format (connection config, engine, query, assertions)
- [x] Zod schema for DB checks
- [x] Generator: DB YAML -> Playwright tests with CLI (sqlite3/psql)
- [x] Wire into `shipflow gen` and `shipflow verify`
- [x] Support SQLite and PostgreSQL

## Block 4: NFR verification vertical (k6) ✅

Generate performance/load test scripts from budget definitions.

- [x] Define `vp/nfr/*.yml` format (endpoint, method, thresholds, VUs, duration)
- [x] Zod schema for NFR checks
- [x] Generator: NFR YAML -> k6 JavaScript scripts (`.gen/k6/*.js`)
- [x] Runner: execute k6 and capture results in verify
- [x] Wire into `shipflow verify` (run if k6 is available)

## Block 5: OPA/Rego policy gate ✅

Enforce organizational rules before verification runs.

- [x] Define policy evaluation point in `verify` pipeline (before running tests)
- [x] Load `vp/policy/*.rego` files
- [x] Call `opa eval` with current context (VP manifest, lock)
- [x] Block verification if policy denies
- [x] Emit policy decision in `evidence/policy.json`

## Block 6: Adapter hooks ✅

Ship concrete hook scripts so AI agents are constrained out of the box.

- [x] Claude Code: `PreToolUse` hook — block file writes to `vp/`, `.gen/`, `evidence/`
- [x] Claude Code: `Stop` hook — run `shipflow gen` + `shipflow verify`, block stop if red
- [x] Document hook installation steps (CLAUDE.md snippet)
- [x] Codex CLI adapter (`hooks/codex-guard.sh`)
- [x] Gemini CLI adapter (`hooks/gemini-guard.sh`)

## Block 7: Framework testing and CI ✅

- [x] Unit tests for `lib/gen.js` (parse + generate round-trip)
- [x] Unit tests for `lib/verify.js` (lock validation, summary parsing)
- [x] Unit tests for Zod schemas (valid/invalid inputs)
- [x] Unit tests for NFR, init, status
- [x] Integration test: full `gen` cycle on a fixture `vp/`
- [x] CI pipeline (GitHub Actions): test on Node 18/20/22
- [x] Test runner: `node:test`

## Block 8: CLI and DX improvements ✅

- [x] `shipflow init` command — scaffold `vp/` directory structure in an app repo
- [x] `shipflow status` command — show what's generated, what's stale, what's missing
- [x] Colored terminal output (pass/fail/skip) with NO_COLOR support
- [x] Summary report after `verify` (X passed, Y failed, Z skipped)
- [x] `--verbose` / `--quiet` flags
- [x] Exit codes documentation (0=success, 1=fail, 2=usage, 3=policy)
