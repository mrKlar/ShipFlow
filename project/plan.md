# ShipFlow - Implementation Plan

## Block 1: Harden the UI vertical

The UI path (YAML -> Playwright) works end-to-end but the DSL is limited.

- [ ] Add `fill` step (text input by role/testid)
- [ ] Add `select` step (dropdowns)
- [ ] Add `hover` step
- [ ] Add `visible` / `hidden` assertions
- [ ] Add `url_matches` assertion (post-navigation checks)
- [ ] Add `count` assertion (number of matching elements)
- [ ] Support multi-step flows with named fixtures (login once, reuse session)
- [ ] Better error messages on schema validation failure (show file + line)

## Block 2: API verification vertical

Generate HTTP contract tests from OpenAPI specs and JSON Schema.

- [ ] Parser for `vp/api/openapi.yaml` (extract endpoints, status codes, schemas)
- [ ] Parser for `vp/api/*.schema.json` (response body validation)
- [ ] Generator: OpenAPI + schemas -> runnable test files (Playwright API or lightweight HTTP runner)
- [ ] Wire into `shipflow gen` (detect `vp/api/` presence)
- [ ] Wire into `shipflow verify` (run API tests alongside UI tests)

## Block 3: Data verification vertical

Run SQL assertions against a database to verify data integrity.

- [ ] Define `vp/data/*.yml` format (connection config, query, expected rows/values)
- [ ] Zod schema for data checks
- [ ] Generator: data YAML -> runnable JS test files
- [ ] Wire into `shipflow gen` and `shipflow verify`
- [ ] Support at minimum PostgreSQL (via `pg` or generic JDBC-like approach)

## Block 4: NFR verification vertical (k6)

Generate performance/load test scripts from budget definitions.

- [ ] Define `vp/nfr/*.yml` format (endpoint, method, thresholds, VUs, duration)
- [ ] Zod schema for NFR checks
- [ ] Generator: NFR YAML -> k6 JavaScript scripts (`.gen/k6/*.js`)
- [ ] Runner: execute k6 and capture results into `evidence/`
- [ ] Wire into `shipflow verify` (run after functional tests pass)

## Block 5: OPA/Rego policy gate

Enforce organizational rules before verification runs.

- [ ] Define policy evaluation point in `verify` pipeline (before running tests)
- [ ] Load `vp/policy/*.rego` files
- [ ] Call `opa eval` with current context (VP manifest, lock, git metadata)
- [ ] Block verification if policy denies
- [ ] Emit policy decision in `evidence/policy.json`

## Block 6: Adapter hooks

Ship concrete hook scripts so AI agents are constrained out of the box.

- [ ] Claude Code: `PreToolUse` hook — block file writes to `vp/`, `.gen/`, `evidence/`
- [ ] Claude Code: `Stop` hook — run `shipflow gen` + `shipflow verify`, block stop if red
- [ ] Document hook installation steps (CLAUDE.md snippet)
- [ ] Codex CLI adapter (equivalent constraints)
- [ ] Gemini CLI adapter (equivalent constraints)

## Block 7: Framework testing and CI

The framework itself has zero tests. Fix that before it grows.

- [ ] Unit tests for `lib/gen.js` (parse + generate round-trip)
- [ ] Unit tests for `lib/verify.js` (lock validation, evidence output)
- [ ] Unit tests for Zod schemas (valid/invalid inputs)
- [ ] Integration test: full `gen` -> `verify` cycle on a fixture `vp/`
- [ ] CI pipeline (GitHub Actions): lint, test, run on Node 20+
- [ ] Add a test runner (`vitest` or `node:test`)

## Block 8: CLI and DX improvements

- [ ] `shipflow init` command — scaffold `vp/` directory structure in an app repo
- [ ] `shipflow status` command — show what's generated, what's stale, what's missing
- [ ] Colored terminal output (pass/fail/skip)
- [ ] Summary report after `verify` (X passed, Y failed, Z skipped)
- [ ] `--verbose` / `--quiet` flags
- [ ] Exit codes documentation

## Suggested order

```
Block 7 (tests)  ->  Block 1 (UI polish)  ->  Block 6 (adapters)
                 ->  Block 2 (API)
                 ->  Block 5 (policy)
                 ->  Block 3 (data)
                 ->  Block 4 (NFR)
                 ->  Block 8 (DX)
```

Block 7 first: having tests in place before extending avoids regressions.
Block 6 early: adapters are the core value prop — constraining AI agents.
Blocks 2-4 are independent verticals that can be built in parallel.
Block 8 is ongoing polish.
