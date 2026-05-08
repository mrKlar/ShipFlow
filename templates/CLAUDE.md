# ShipFlow

This project uses ShipFlow for **understanding-to-verification-first** shipping. The verification pack is the executable capture of validated understanding, not a generated artifact you trust by default. Treat human judgment as a first-class artifact: capture it as grill transcripts, decisions, slices, approvals, and structured artifact reviews.

## Two Phases

### Phase 1: Validated Understanding → Verification Pack

Before drafting any YAML, run a sensemaking pass:
- `shipflow grill --ai --role=general|product|architecture|qa|security|risk --intent="..."` produces `.shipflow/grill/<id>.{md,json}` — questions, ambiguities, edge cases, assumptions.
- Walk the markdown transcript with the user. Capture answers inline.
- Promote agreed-upon outcomes with `shipflow grill promote <session-id> --decision=<id>`. The decision lands in `.shipflow/decisions/<id>.yml` with `source: grill` and `source_ref: <session-id>`.
- Use `shipflow decision new` / `shipflow decision link` to bind every non-obvious constraint to its question, decision, rationale, and the vp files it impacts.

Then **generate** the pack from that substrate — never hand-author the YAML. Run `shipflow draft --ai --write "<intent>"` (or `/shipflow:draft`) which reads the grill transcripts and decisions and proposes narrow `vp/**/*.yml` files. Your job on the proposed files is **review and tighten**, not author from scratch:
- read each generated file with the user; if a proposal is wrong, correct it; if it is missing a negative case, add one; if the team disagrees, push back to the grill before the constraint is approved.
- `shipflow decision link <id> --vp=<generated-path>` binds each new vp file to the decision that justifies it.
- Group user-visible work into slices (`shipflow slice new --id=... --goal="..."`), linking the slice to its decisions, grill sessions, and the generated vp files.

If the user asks you to write a vp file directly, push back: send them through grill+decision first, then run draft. Hand-authored YAML without the substrate is the failure mode this framework prevents.

For brownfield projects, run `shipflow discover` first; it scans existing UI routes, API endpoints, DB tables, auth/security signals, and technical artifacts and proposes regression VPs that lock current behavior before refactors change it.
Treat deterministic ShipFlow starters as archetype-level base constraints: base stack, protocol, architecture, security, delivery, and other scaffold-defined boundaries. Keep speculative product-level checks pending until the user clarifies them or explicitly delegates the choice.
During drafting, first summarize what ShipFlow understood. On an empty or low-signal greenfield repo, ask only the single highest-leverage next question from `shipflow draft --json`, rerun `shipflow draft --json` after each answer, then narrow into UI, behavior, API, database, performance, security, and technical using ShipFlow's per-type discussion prompts and best practices as a checklist. Surface at most one or two best-practice prompts for the current type, ask clarifications when the draft marks a decision unresolved, do not present a long list of open questions spanning several verification types in one turn, and do not inspect the installed ShipFlow wrapper/package, examples, templates, or source files to reverse-engineer the YAML format during a normal draft flow.

Eight verification types plus fixtures and policy:
- `vp/ui/*.yml` — UI checks (browser interactions + assertions)
- `vp/behavior/*.yml` — behavior checks (Given/When/Then scenarios)
- `vp/domain/*.yml` — business-domain checks (objects, invariants, access patterns, data-engineering translation)
- `vp/api/*.yml` — API checks (HTTP requests + response assertions)
- `vp/db/*.yml` — Database checks (SQL queries + row/cell assertions)
- `vp/nfr/*.yml` — Performance checks (load/performance thresholds)
- `vp/security/*.yml` — Security checks (auth/authz/headers/exposure)
- `vp/technical/*.yml` — Technical checks (frameworks/architecture/CI/infra/tooling)
- `vp/ui/_fixtures/*.yml` — reusable setup flows (login, etc.)
- `vp/policy/*.rego` — OPA policy gates

You MAY modify these surfaces during this phase only:
- `vp/**` — verification pack
- `.shipflow/slices/**` — vertical slices
- `.shipflow/decisions/**`, `.shipflow/grill/**`, `.shipflow/reviews/**`, `.shipflow/governance.yml` — substrate
- `.shipflow/approvals/**` is append-only via `shipflow approve-pack`
- `.shipflow/discovered/**` is append-only via `shipflow discover`

Run `shipflow critique` to score the cognitive quality of the pack (negative cases, decision linkage, vague titles, placeholders) before approval. Capture concerns with `shipflow review-artifact new --target=... --target-kind=...`.

Sign the pack with `shipflow approve-pack` once a human reviewer has read it. Approval is sha256-bound: any later change to `vp/**` invalidates it until re-signed.

### Phase 2: Implementation (AI-led, pack-controlled)

Implement app code that passes all generated checks. Treat the verification pack as ground truth; if it is wrong or ambiguous, stop and go back to Phase 1.

## Normal Flow

```
1. Finalize verifications in `vp/`
2. Prefer `shipflow implement` for the normal implementation loop
3. Use granular commands only when debugging or inspecting the pipeline
```

Do NOT skip any step. Do NOT report completion until `shipflow verify` exits 0.

Before `shipflow implement`, run `shipflow status --json`. Only continue when `implementation_gate.ready === true`.
Inspect ShipFlow JSON directly; do not wrap it in `python`, `jq`, or shell pipelines unless ShipFlow itself returned malformed output. Run `shipflow` directly; if it is not on PATH, retry `~/.local/bin/shipflow` directly and do not inspect the wrapper.
Run `shipflow implement` directly; do not manually unset CLI session variables as a workaround.

During implementation, use Claude Code native subagents via the `Task` tool:
- `shipflow-strategy-lead` for orchestration and strategy changes when the loop stalls
- `shipflow-architecture-specialist`, `shipflow-ui-specialist`, `shipflow-api-specialist`, `shipflow-database-specialist`, `shipflow-security-specialist`, `shipflow-technical-specialist` for narrow repair slices
- keep each Task delegation tied to one verification slice and one evidence target
- let the orchestrator own the global loop and integration decisions

## Protected Paths — NEVER Modify During Implementation

- `vp/**` — Verification pack (executable capture of validated understanding)
- `.shipflow/slices/**` — Vertical slices linking intent → decisions → vp → evidence
- `.gen/**` — Generated tests
- `evidence/**` — Verification output
- `.shipflow/**` — Substrate (decisions, grill, approvals, reviews, discovered, governance) and runtime state
- `shipflow.json` — Framework config

If a verification seems wrong, STOP. Go back to Phase 1, capture the concern with `shipflow review-artifact new`, fix the pack, and re-sign with `shipflow approve-pack`.

## What to Match in Your Implementation

For UI checks, and behavior checks compiled to Playwright web flows, these locators apply:

| VP concept | Your code must provide |
|---|---|
| `testid: foo` | `data-testid="foo"` attribute |
| `label: Email` | `<label>Email</label>` + associated input |
| `click: { name: Submit }` | `<button>Submit</button>` |
| `role: link, name: Home` | `<a>Home</a>` |
| `visible: { testid: x }` | Element visible in DOM |
| `hidden: { testid: x }` | Element in DOM but hidden |
| `count: { testid: x, equals: 3 }` | Exactly 3 elements with that testid |

For API checks: implement endpoints matching the `method`, `path`, response `status`, headers, and JSON body.

For DB checks: ensure the database schema and data match the `query` and assertions.

For technical checks: ensure the repository structure, manifests, workflows, architecture boundaries, and declared tooling/services match the assertions. Choose `runner.kind` / `runner.framework` deliberately and prefer backend-native technical rules over smoke commands.

If a verification fails because the backend, database, runtime, or dependency stack is broken, fix that real failure. Never fake green by returning canned values, bypassing storage, suppressing errors, weakening checks, or otherwise making the test appear to pass while the underlying system is still broken.

If `vp/domain/**` exists, treat it as the business-domain source of truth. Do a real data-engineering step from business objects to technical storage/read/write/exchange objects, and normalize driver-native values such as BigInt ids, numeric strings, binary payloads, or DB timestamps before exposing them through JSON, REST, GraphQL, UI state, or events.

Treat the startup scaffold or archetype plugin as the initial dependency baseline. Extend that baseline only when a verification really requires it.

Prefer the platform, the framework, and dependencies already installed by the scaffold before adding any new npm package. Never guess package names. If you are not certain a dependency exists and is required, do not add it.

For GraphQL browser work, prefer `fetch` against `/graphql` unless the scaffold already includes an approved GraphQL client.

For SQLite work, use `node:sqlite` when the scaffold or verification pack expects SQLite. Do not import `node:sqlite3`, do not shell out to `sqlite3`, and do not add `sqlite3` or `better-sqlite3`.

For browser UI work: reuse the design system or open-source design-system component library already present in the repo. If none exists and the user did not explicitly ask for a bespoke internal UI kit, use a standard, widely used open-source design-system component library appropriate to the stack instead of inventing one-off primitives. Only create a new local shared component library when the user explicitly asks for it or the repo already follows that pattern.

## Commands

```bash
# Sensemaking before authoring the pack
shipflow grill "<intent>" --ai --role=general|product|architecture|qa|security|risk
shipflow grill list | show <id> | promote <session-id> --decision=<proposed-id>
shipflow decision new --id=... --title="..." --question="..." --decision="..." --rationale="..." [--source=grill --source-ref=<grill-id>] [--impacts=vp/path.yml]
shipflow decision list | show <id> | link <id> --vp=... | unlink <id> --vp=...

# Standard authoring + drafting
shipflow draft "<user request>"       # Standard flow: co-draft and refine the verification pack
shipflow draft --clear-session
shipflow draft --accept=vp/path.yml [--write] [--update-existing]
shipflow draft --pending=vp/path.yml
shipflow slice new --id=... --goal="..." [--vp=...] [--decision=...] [--grill=...]
shipflow slice list | show <id> | link/unlink <id> --vp=... | set-status <id> --status=...
shipflow critique                     # Cognitive quality scoring (advisory)
shipflow preview                      # Concrete artifacts available for human review
shipflow review-artifact new --target=... --target-kind=vp|slice|evidence|... --text="..."
shipflow review-artifact list | show <id> | resolve/wont-fix/reopen <id>

# Approval (gate-able via impl.requirePackApproval / SHIPFLOW_REQUIRE_APPROVAL=1)
shipflow approve-pack [--approver=... --role=architect|product|qa|security|engineering --decision-ref=... --grill-ref=...]
shipflow approve-pack status | list | show <id> | revoke <id>

# Implementation
shipflow implement                    # Standard flow: validate, generate, implement, verify
shipflow implement-once               # Single implementation pass, no retry loop

# Brownfield + audit
shipflow discover                     # Scan repo and propose regression VPs
shipflow trace [--json|--markdown]    # Traceability matrix
shipflow governance init | check | show

# Advanced / debug
shipflow map "<user request>"
shipflow doctor
shipflow lint
shipflow gen
shipflow verify
shipflow status
```

Only use `--update-existing` with explicit approval before replacing an existing verification file.
Use `--reject` only when a candidate is explicitly out of scope:

```bash
shipflow draft --reject=vp/path.yml
```

## On Verify Failure

For Playwright-backed UI checks, common fixes:
- **Element not found** → missing `data-testid`, wrong label/button text
- **Text mismatch** → wrong textContent in your HTML/JS
- **Timeout** → element never appears; check rendering
- **Count mismatch** → wrong number of elements
- **URL mismatch** → navigation doesn't produce expected URL
- **Status mismatch** → API returns wrong HTTP status
- **JSON mismatch** → API response body doesn't match assertions

Fix the real code or runtime problem, run `shipflow verify` again, and repeat until green. Do not fake green by bypassing a broken backend, database, or dependency.
