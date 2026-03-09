# Verification Pack (ShipFlow)

## Principle

Only `vp/` is human-readable and editable. Everything else is generated or opaque implementation.

## Directories

| Directory | Role | Editable |
|---|---|---|
| `vp/` | Verification pack | Yes (verification phase only) |
| `.gen/` | Generated tests | No (produced by `shipflow gen`) |
| `evidence/` | Test results | No (produced by `shipflow verify`) |

## Verification Types

| Type | Path | Schema | Generates |
|---|---|---|---|
| UI | `vp/ui/*.yml` | Flow + assert | Playwright browser tests |
| Behavior | `vp/behavior/*.yml` | Given/when/then | Scenario artifacts for web, API, or TUI behavior; can compile to Playwright-backed tests or Cucumber/Gherkin |
| API | `vp/api/*.yml` | Request + assert | Playwright API tests (no browser) |
| Database | `vp/db/*.yml` | Query + assert | Playwright tests with CLI (sqlite3/psql) |
| Performance | `vp/nfr/*.yml` | Scenario + thresholds | k6 load test scripts |
| Security | `vp/security/*.yml` | Request + assert | Playwright API security tests |
| Technical | `vp/technical/*.yml` | Repo constraints + assertions | Dedicated technical backend runners (`.gen/technical/*.runner.mjs`) |
| Policy | `vp/policy/*.rego` | OPA/Rego rules | Policy evaluation gate |
| Fixtures | `vp/ui/_fixtures/*.yml` | Flow only | Inlined into UI/behavior tests |

## Generated Output

UI, API, database, and security verifications compile to `.gen/playwright/*.test.ts` by default.
Behavior checks can compile either to Playwright-backed tests or to `.gen/cucumber/features/*.feature` plus `.gen/cucumber/step_definitions/*.steps.mjs` when the Cucumber runner is selected.
Performance verifications compile to `.gen/k6/*.js`.
Technical verifications compile to `.gen/technical/*.runner.mjs`, with optional framework-specific config companions when `runner.framework` selects a specialized backend such as `dependency-cruiser`, `tsarch`, `madge`, or `eslint-plugin-boundaries`.

The lock file `.gen/vp.lock.json` records SHA-256 hashes of every file in `vp/` and every generated artifact in `.gen/` except the lock file itself.

## Execution

`shipflow verify`:
1. Validates the cryptographic lock (`vp/` and `.gen/` unchanged since `gen`)
2. Evaluates OPA policies (if `vp/policy/*.rego` exist) → `evidence/policy.json`
3. Runs generated Playwright tests per verification type and writes `evidence/*.json`
4. Runs k6 NFR scripts when `.gen/k6/*.js` exist. Missing `k6` is a verification failure, not a skip → `evidence/load.json`
5. Runs generated technical backend runners when `.gen/technical/*.runner.mjs` exist → `evidence/technical.json`
6. Emits aggregate `evidence/run.json` with group summaries
7. `shipflow implement` emits `evidence/implement.json` with the latest loop result
8. `shipflow status` may also show recent implementation history when available
9. Prints colored summary
10. Exits 0 if all pass, 1 if tests fail, 3 if policy denies

`shipflow draft`:
1. Builds a repo coverage map
2. Folds in the user request when provided
3. Summarizes gaps and ambiguities
4. Proposes starter verifications
5. Optionally writes starter files to `vp/` with `--write`

## Anti-Cheat Invariants

- Implementation phase MUST NOT modify `vp/`, `.gen/`, or `evidence/`
- `.gen/` is regenerated only via `shipflow gen`
- The cryptographic lock prevents tampering between `gen` and `verify` for both the pack and generated artifacts
- Claude Code hooks enforce these constraints automatically
- Codex CLI and Gemini CLI guard scripts available in `hooks/`
