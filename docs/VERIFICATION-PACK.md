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
| DB | `vp/db/*.yml` | Query + assert | Playwright tests with CLI (sqlite3/psql) |
| Fixtures | `vp/ui/_fixtures/*.yml` | Flow only | Inlined into UI/behavior tests |

## Generated Output

All verification types compile to `.gen/playwright/*.spec.ts`.

The lock file `.gen/vp.lock.json` records SHA-256 hashes of every file in `vp/`.

## Execution

`shipflow verify`:
1. Validates VP lock (VP unchanged since `gen`)
2. Runs generated Playwright tests
3. Emits `evidence/run.json`
4. Exits 0 if all pass

## Anti-Cheat Invariants

- Implementation phase MUST NOT modify `vp/`, `.gen/`, or `evidence/`
- `.gen/` is regenerated only via `shipflow gen`
- VP lock prevents tampering between gen and verify
- Claude Code hooks enforce these constraints automatically
