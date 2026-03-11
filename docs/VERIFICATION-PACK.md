# Verification Pack (ShipFlow)

## Principle

Only `vp/` is the durable, human-editable definition of what must be true. Everything else is generated artifacts or implementation.

That durability now covers more of the real product boundary: visible UI contracts, approved visual baselines, business-domain objects and data objects, runtime and stack constraints, and app-shape-aware bundles for frontend apps, fullstack apps, REST services, and terminal products.

## Directories

| Directory | Role | Editable |
|---|---|---|
| `vp/` | Verification pack | Yes (verification phase only) |
| `.gen/` | Generated tests | No (produced by `shipflow gen`) |
| `evidence/` | Test results | No (produced by `shipflow verify`) |

## Verification Types

| Type | Path | Schema | Generates |
|---|---|---|---|
| UI | `vp/ui/*.yml` | Flow + assert + optional visual contract | Playwright browser tests with optional snapshot/diff flow |
| Behavior | `vp/behavior/*.yml` | Given/when/then | Scenario artifacts for web, API, or TUI behavior; can compile to Playwright-backed tests or Cucumber/Gherkin |
| Business Domain | `vp/domain/*.yml` | Business object + invariants + access patterns + data engineering | Business-domain runners (`.gen/domain/*.runner.mjs`) |
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
Business-domain verifications compile to `.gen/domain/*.runner.mjs`.
Performance verifications compile to `.gen/k6/*.js`.
Technical verifications compile to `.gen/technical/*.runner.mjs`, with optional framework-specific config companions when `runner.framework` selects a specialized backend such as `dependency-cruiser`, `tsarch`, `madge`, or `eslint-plugin-boundaries`.

The business-domain layer is where ShipFlow makes stateful and integration-heavy systems explicit before implementation:
- business objects
- identities
- references
- invariants
- read/write access patterns
- technical data objects produced by data engineering

That last point matters. `vp/domain/*.yml` does not force business objects to be implemented 1:1 as tables or payloads. Instead, it locks the required translation into technical data objects such as canonical storage models, read models, write models, and exchange models.

When a UI check includes a `visual` block, the generated Playwright test also performs structured visual assertions and snapshot comparison. Approved baselines live under `vp/ui/_baselines/<check-id>/`. Regression artifacts are written under `evidence/visual/<check-id>/`.

The lock file `.gen/vp.lock.json` records SHA-256 hashes of every file in `vp/` and every generated artifact in `.gen/` except the lock file itself.

## Execution

`shipflow verify`:
1. Validates the cryptographic lock (`vp/` and `.gen/` unchanged since `gen`)
2. Evaluates OPA policies (if `vp/policy/*.rego` exist) → `evidence/policy.json`
3. Runs generated Playwright tests per verification type and writes `evidence/*.json`
4. Writes `expected`, `actual`, `diff`, and metrics artifacts under `evidence/visual/` when UI visual contracts are present
5. Runs k6 NFR scripts when `.gen/k6/*.js` exist. Missing `k6` after ShipFlow bootstrap is a verification failure, not a skip → `evidence/load.json`
6. Runs generated business-domain runners when `.gen/domain/*.runner.mjs` exist → `evidence/domain.json`
7. Runs generated technical backend runners when `.gen/technical/*.runner.mjs` exist → `evidence/technical.json`
8. Emits aggregate `evidence/run.json` with group summaries
9. `shipflow implement` updates `evidence/implement.json` as it advances through bootstrap, generation, implementation, and verification
10. `shipflow status` may also show recent implementation history when available
11. Prints colored summary
12. Exits 0 if all pass, 1 if tests fail, 3 if policy denies

`shipflow approve-visual`:
1. Reads the current UI pack
2. Selects visual UI checks by id or file path, or all of them when no filter is given
3. Runs the generated Playwright visual flow in approval mode
4. Writes approved baselines into `vp/ui/_baselines/<check-id>/`
5. Leaves `verify` strict: no implicit baseline refresh, no silent self-approval

`shipflow draft`:
1. Builds a repo coverage map
2. Folds in the user request when provided
3. Summarizes gaps and ambiguities
4. Proposes starter verifications
   On greenfield repos, these starters can include technical boundary files such as `vp/technical/runtime-environment.yml`, `vp/technical/framework-stack.yml`, and `vp/technical/ui-component-library.yml` so the initial verification runtime, declared stack, and design-system direction become part of the pack immediately.
   On stateful or integration-heavy repos, these starters can also include `vp/domain/*.yml` so the business-domain objects and required technical data objects are locked before implementation.
5. Optionally writes starter files to `vp/` with `--write`

The draft is archetype-aware. It can distinguish:
- frontend web apps
- fullstack web apps
- REST backend services
- CLI / TUI apps

That matters because ShipFlow proposes different baseline bundles for different realities. A REST backend service can now be drafted as a first-class product boundary, including database-backed services and services that fan out across multiple upstream APIs.

## Anti-Cheat Invariants

- Implementation phase MUST NOT modify `vp/`, `.gen/`, or `evidence/`
- `.gen/` is regenerated only via `shipflow gen`
- The cryptographic lock prevents tampering between `gen` and `verify` for both the pack and generated artifacts
- Claude Code hooks enforce these constraints automatically
- Codex CLI and Gemini CLI guard scripts available in `hooks/`
