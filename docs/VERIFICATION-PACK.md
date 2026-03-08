# Verification Pack (ShipFlow)

## Principle

Only `vp/` is human-readable and reviewed. Everything else is generated or opaque implementation.

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
| Behavior | `vp/behavior/*.yml` | Given/when/then | Playwright browser tests (BDD structure) |
| API | `vp/api/*.yml` | Request + assert | Playwright API tests (no browser) |
| Database | `vp/db/*.yml` | Query + assert | Playwright tests with CLI (sqlite3/psql) |
| Performance | `vp/nfr/*.yml` | Scenario + thresholds | k6 load test scripts |
| Security | `vp/security/*.yml` | Request + assert | Playwright API security tests |
| Technical | `vp/technical/*.yml` | Repo constraints + assertions | Playwright repo inspection tests |
| Policy | `vp/policy/*.rego` | OPA/Rego rules | Policy evaluation gate |
| Fixtures | `vp/ui/_fixtures/*.yml` | Flow only | Inlined into UI/behavior tests |

## Generated Output

Functional verifications, security verifications, and technical verifications compile to `.gen/playwright/*.test.ts`.
Performance verifications compile to `.gen/k6/*.js`.

The lock file `.gen/vp.lock.json` records SHA-256 hashes of every file in `vp/`.

## Execution

`shipflow verify`:
1. Validates VP lock (VP unchanged since `gen`)
2. Evaluates OPA policies (if `vp/policy/*.rego` exist) → `evidence/policy.json`
3. Runs generated Playwright tests per verification type and writes `evidence/*.json`
4. Runs k6 NFR scripts (if `.gen/k6/*.js` exist and k6 is available) → `evidence/load.json`
5. Emits aggregate `evidence/run.json` with group summaries
6. `shipflow implement` emits `evidence/implement.json` with the latest loop result
7. `shipflow status` may also show recent implementation history when available
8. Prints colored summary
9. Exits 0 if all pass, 1 if tests fail, 3 if policy denies

`shipflow draft`:
1. Builds a repo coverage map
2. Folds in the user request when provided
3. Summarizes gaps and ambiguities
4. Proposes starter verifications
5. Optionally writes starter files to `vp/` with `--write`

## Anti-Cheat Invariants

- Implementation phase MUST NOT modify `vp/`, `.gen/`, or `evidence/`
- `.gen/` is regenerated only via `shipflow gen`
- VP lock prevents tampering between gen and verify
- Claude Code hooks enforce these constraints automatically
- Codex CLI and Gemini CLI guard scripts available in `hooks/`
