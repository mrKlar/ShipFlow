# Changelog

All notable changes to ShipFlow are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-05-08

The "understanding-to-verification-first" release. ShipFlow stops asking the team to hand-author a verification pack and starts asking them to validate shared understanding *first*; the pack is then generated from that durable substrate.

A pure verification-first framing was insufficient: an AI-generated YAML pack disconnected from human judgment is just an AI-generated PRD with a `.yml` extension. This release closes that gap with grill (sensemaking), decisions (durable judgment), and a sha256-bound human approval that gates the implement loop.

### Added — substrate (the human-judgment side)

- **`shipflow grill`** — AI-augmented Three-Amigos session. Surfaces ambiguities, contradictions, edge cases, assumptions, and proposed decisions before any constraint is written. Five role lenses: `general`, `product`, `architecture`, `qa`, `security`, `risk`. `--multi` fans out across all five specialist roles in one command. Sessions live as `.shipflow/grill/<id>.{md,json}`.
- **`shipflow decision`** — durable decision log. Each non-obvious call is captured as `.shipflow/decisions/<id>.yml` with question, decision, rationale, and source (grill / review / incident / client-feedback / discovery / manual). `link`/`unlink` bind a decision to the vp files it impacts.
- **`shipflow slice`** — vertical tracer-bullets that group intent + decisions + vp + grill_refs + evidence into one user-visible outcome. `link` validates that referenced decisions and grill sessions actually exist; missing references fail loudly.
- **`shipflow review-artifact`** — structured feedback against any target (vp / slice / decision / evidence / screenshot / api_sample / grill). Statuses: `open` / `resolved` / `wont_fix` / `obsolete`. Pairs with `shipflow preview` which surfaces every concrete artifact ready for review.
- **`shipflow approve-pack`** — sha256-bound human signoff. Approval id ties an approver + role to the current `vp/**` hash. Any later edit to a vp file invalidates every active approval. Opt-in gating via `impl.requirePackApproval` (or `SHIPFLOW_REQUIRE_APPROVAL=1`) makes `shipflow implement` refuse to run without an active approval.

### Added — quality + audit

- **`shipflow critique`** — cognitive-quality score on top of `lint`. Heuristics: `critique.no_decision_link`, `critique.happy_path_only`, `critique.{behavior|api|security}_no_negative`, `critique.vague_title`, `critique.placeholder_present` (error), `critique.security_without_policy`, `critique.decision_unlinked`. `--threshold=N` exits non-zero below the score (CI gate); errors always fail regardless of the threshold.
- **`shipflow trace`** — read-only traceability matrix joining vp ↔ decisions ↔ grill ↔ slices ↔ generated tests ↔ evidence ↔ approvals ↔ reviews. `--markdown` and `--pr-comment` formats; `--pr-comment` includes a focused action list ("Bind a decision to vp/...", "Resolve N reviews", "Run shipflow approve-pack") suitable for `gh pr comment`.
- **`shipflow report`** — aggregate snapshot for weekly status: vp count, decisions, slices, approvals, open reviews, days since last verify run. Human / `--markdown` / `--json`.
- **`shipflow governance`** — versioned org policy at `.shipflow/governance.yml`. Fields: `require_pack_approval`, `required_approver_roles`, `required_grill_roles`, `min_decisions_per_vp`, `require_negative_cases`, `forbid_orphan_decisions`, `forbid_open_reviews`. `governance check` enforces the policy and surfaces substrate load errors as findings.

### Added — brownfield + tooling

- **`shipflow discover`** — brownfield scanner. Walks src/ for UI routes, REST and GraphQL endpoints, DB tables, auth/security signals, technical artifacts. Proposes regression VPs at stable `vp/<area>/regression-<slug>.yml` paths. Surfaces already covered by an existing vp file are filtered out.
- **`shipflow discover promote`** — materializes a proposal into a schema-valid scaffold with explicit `TODO` markers, so `shipflow critique` flags it as `placeholder_present` until the user replaces them with real assertions.
- **`shipflow migrate`** — idempotent layout migrations for older repos: moves legacy `slice/` to `.shipflow/slices/`, replaces blanket `.shipflow/` ignore with the precise runtime-only list. Dry-run by default.
- **`shipflow init --github-action`** — scaffolds `.github/workflows/shipflow.yml` with lint + critique threshold + governance + trace pr-comment posting (find-then-update pattern with a stable comment marker).

### Added — agents, integrations, examples

- **5 specialist grill subagents** in `plugin/agents/grill-{product,architecture,qa,security,risk}.md`. Each agent runs `shipflow grill --role=<role>` and is explicitly told NOT to cover other lenses' territory.
- **`examples/session-expiry-substrate/`** — canonical "substrate side" example complementing `todo-app`'s implementation-side demo. Shows the audit chain grill → decision → slice → vp.
- **GitHub Action workflow template** at `templates/github-actions/shipflow-pr.yml`.

### Changed

- **README** rewritten as marketing copy (240 → 98 lines). Walkthrough lives in `docs/USER-GUIDE.md`.
- **User Guide walkthrough** rewritten to enforce the correct flow: `grill → decisions → draft (generates) → review → critique → approve → trace`. The pack is **never seeded by hand**.
- **All four platform templates** (`templates/{CLAUDE,AGENTS,GEMINI,KIRO}.md`) and the User Guide / Verification Pack reference / Scientific Foundations updated to teach the same flow. Templates instruct the AI agent to push back when the user asks it to write a vp file directly without going through grill+decision.
- **Slice storage moved** from `slice/` (root) to `.shipflow/slices/` for layout consistency. `shipflow migrate` handles the upgrade.
- **`.gitignore` template** in `shipflow init` now ignores only the runtime parts of `.shipflow/` (`runtime/`, `draft-session.json`, `implement-thread.json`, `scaffold-state.json`). The durable substrate (decisions, grill, slices, approvals, reviews, governance.yml, discovered) is committed by default.

### Fixed

- **`trace.js` "generated" column never populated.** Manifest fields (`entries`, `source`, `path`, `target`) were never produced by `lib/gen.js`. Fixed by adding `vp_file` to each generated check in the manifest and walking `outputs[area].checks[]` instead of the fictional `entries[]`. Caught by the new substrate-flow integration test.
- **Approval id collisions in the same millisecond.** Synchronous back-to-back `approvePack` calls used the same timestamp-based id. Fixed with a `nextAvailableId` fallback that appends `-2`, `-3`, ... when caller did not supply an explicit id. `timestampStamp` now keeps millisecond precision.
- **Substrate loader errors silently discarded.** `runGovernanceCheck` and `buildTrace` destructured `loadX(cwd).items` without surfacing `.issues`, so a corrupt YAML in `.shipflow/decisions/` would silently make `required_approver_roles` appear unmet for the wrong reason. Both now emit `governance.substrate_load_error` findings / `loader_issues[]` in trace.
- **Slice referential integrity gap.** `linkSlice` validated decision and grill ids on write but `loadSlices` did not. A hand-edit pointing at a deleted decision survived. `loadSlices` now emits `slice.dangling_decision` / `slice.dangling_grill_ref` issues.
- **`pack_sha256` regex was case-insensitive** while downstream `===` is strict. Tightened to lowercase-only.
- **`GrillQuestion.id` and `GrillFinding.id`** had no format constraint despite the prompt contract documenting kebab-case. Promoted to a shared `KEBAB_ID` schema.
- **Hardcoded `/home/n/...` paths** in the shipped `templates/codex-rules.rules`. Replaced with a `__SHIPFLOW_HOME__` placeholder that `install.sh` and `lib/init.js` substitute at install time. Test pins the invariant.
- **Examples `.gen/` was stale** in `todo-app`, `api-db-service`, `security-load-app` (missing `vp_file` field, hardcoded base URL instead of `SHIPFLOW_BASE_URL`). Regenerated.

### Removed

- Legacy fallback property reads in `manifestOutputsByVpFile` for fields no manifest version has ever produced (`entry.source`, `entry.input`, `entry.path`, `entry.target`).
- Unused `DiscoverySession.by_kind` field — written, never read.
- Undocumented `new` / `approve` subcommand aliases in `approve-pack`.
- Dead re-exports of pure helpers in `lib/grill.js`.
- Duplicate `parseFlags`, `relPath`, `ensureArray`, `slugify`, `timestampStamp`, `todayIso` across modules — centralized in `lib/util/cli.js` and `lib/util/id.js`.
- Duplicate `captureStdio` and `withTmpDir` across nine test files — centralized in `test/util/`.

### Tests

- 736 tests pass, 1 skip, 0 fail.
- New: `test/integration/substrate-flow.test.js` exercises the full grill → decision → slice → critique → approve → trace → governance flow end-to-end. Caught two latent bugs that no unit test had seen.
- New: `test/integration/session-expiry-example.test.js` guards the example against schema drift.
- New: `test/unit/{decisions,grill,grill-prompt,approvals,critique,slices,reviews,discover,trace,governance,report,migrate,workflow-template,util-cli}.test.js` — module unit tests for everything above.

### Migration from 0.3.x

For most users, no action required. If your repo was initialized with an older `shipflow init` and you want the durable substrate (decisions, grill transcripts, etc.) committed to git going forward:

```bash
shipflow migrate         # dry-run, lists what would change
shipflow migrate --apply # rewrite .gitignore + move slice/ if present
```

The CLI surface is fully backward-compatible: existing commands behave the same, and new substrate features are opt-in.

---

## [0.3.0] and earlier

See `git log` for prior history.
