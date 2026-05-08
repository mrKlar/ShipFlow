<div align="center">

# ShipFlow

### *Spec-driven development is dead.*<br>Welcome to **understanding-to-verification-first shipping**.

[![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen)](https://nodejs.org)
[![Tests Passing](https://img.shields.io/badge/tests-passing-brightgreen)](#)
[![License MIT](https://img.shields.io/badge/license-MIT-blue)](#license)

</div>

ShipFlow is a framework for AI coding agents. You do not hand the agent a long spec and hope it interprets it correctly. You grill the intent into validated shared understanding, capture decisions and slices of value, sign off on the resulting verification pack, and let ShipFlow drive implementation until those constraints pass.

```text
Grill the intent  ->  Capture decisions  ->  Draft the pack  ->  Approve  ->
  Generate tests/runners  ->  Scaffold  ->  Implement until green  ->  Trace
```

The verification pack is the **executable capture of validated understanding**, not a generated artifact you trust by default. ShipFlow does not replace human judgment with tests; it captures human judgment as executable verification.

The code is disposable. The verification pack — backed by decisions, grill sessions, slices, approvals, and reviews — is the durable artifact.

## Why ShipFlow

Most AI dev workflows still follow a human process:
- write a spec
- break it into tasks
- let the agent implement
- trust the claim that it is done

A pure "verification-first" framing is not enough either: an AI-generated verification pack disconnected from human judgment is just an AI-generated PRD with a `.yml` extension. ShipFlow closes that gap with a sensemaking phase up front.

ShipFlow replaces both with an understanding-to-verification loop:
- a **grill** phase (Three-Amigos with AI as the fourth scribe) that exposes ambiguities, contradictions, edge cases, and assumptions before any YAML is written
- a **decision log** that binds every constraint to the question, decision, rationale, and source that produced it
- **slices** that group intent + decisions + vp + evidence into reviewable vertical tracer-bullets
- a **pack approval** signature that ties the current pack hash to a named human reviewer (and can gate `implement`)
- real UI, behavior, API, database, technical, and domain checks generated from the approved pack
- cryptographic locks and runtime hooks to stop pack drift during implementation
- a **critique** layer that scores cognitive quality (negative cases, decision linkage, vague titles, placeholders) so the pack cannot pass green while staying weak
- a **trace** matrix that walks intent → grill → decisions → vp → tests → evidence → approval, suitable for PR descriptions and audit
- an org-level **governance** policy expressing what "approved" means in your team
- an implementation loop that ends on verification, not on vibes

ShipFlow owns the top-level workflow:
- `shipflow implement` owns the retry loop
- `shipflow verify` owns the final green/red verdict
- generated runners only execute their slice; they do not decide global success

## What It Can Lock

- Visual UI contracts: layout, placement, spacing, styles, tokens, approved baselines, and screenshot diffs.
- Behavior contracts: what users or clients can actually do end to end.
- API contracts: request and response behavior, including negative cases.
- Database invariants: before and after state, not just HTTP output.
- Business domain contracts: business objects, identities, references, invariants, access patterns, and the data-engineering translation into storage, read, write, and exchange models.
- Technical boundaries: runtime pinning, stack choices, protocols, CI, tooling, and architecture rules.

ShipFlow also understands the shape of the product it is drafting for. It can propose different baseline bundles for frontend apps, fullstack apps, REST backend services, and CLI/TUI apps. For UI-heavy projects, it can also steer greenfield work toward a mainstream open-source design-system library instead of an ad hoc local kit.

## How It Works

1. **Grill the intent** — `shipflow grill --ai --role=...` runs an AI-augmented Three-Amigos session and produces a transcript of questions, ambiguities, edge cases, and assumptions for the team to walk through.
2. **Capture the durable decisions** — `shipflow decision new` records each non-obvious call (with question, decision, rationale, source) into `.shipflow/decisions/`.
3. **Generate the verification pack from the substrate** — `shipflow draft --ai --write` reads the grill transcripts and decisions and produces narrow vp files. **You do not hand-author YAML.** Tightening — not authoring — is the human job.
4. **Critique + approve** — `shipflow critique` scores cognitive quality (negative cases, decision linkage, vague titles). `shipflow approve-pack` records a sha256-bound human signoff.
5. **ShipFlow generates real tests and runners** from the approved pack.
6. **Optional**: ShipFlow can install a deterministic project foundation for the supported stack on a greenfield repo.
7. **ShipFlow drives implementation** until verification is green.

The verification pack is **never seeded by hand**. It is the executable capture of validated understanding — generated *after* the substrate that justifies it exists.

That orchestration is centralized on purpose. The loop, the managed local runtime, and the acceptance decision all live in ShipFlow itself. Playwright, Cucumber, k6, and the technical/domain backends are execution backends, not the owners of completion.

That boundary can go beyond UI and API output.
- For stateful systems, ShipFlow can lock the business domain itself and the required data-engineering translation into technical data objects.
- For UI-heavy systems, ShipFlow can lock approved visual baselines and produce `expected`, `actual`, and `diff` artifacts.
- For backend services, ShipFlow can keep API, database, and technical reality in scope together, including DB-backed and multi-API REST services.
- For greenfield work, ShipFlow can take the unstable "pick the stack, wire the scripts, create the folders, install the base libraries" work away from the LLM entirely.

## Deterministic Foundations

Before the specialists start coding, ShipFlow can apply a deterministic scaffold for supported product shapes. That means the agent does not have to re-decide the same fragile setup details on every run.

- stable package scripts and base dependencies
- stable directory structure and entrypoints
- stable browser/server shell for the supported stack
- a foundation the LLM can build on instead of re-inventing

A startup scaffold is not just starter code. It also carries the archetype's base verification files under `vp/`, so the initial shell, protocol, runtime, architecture, and security expectations are part of the locked pack from day one. There is no separate hidden "universal quality gate" outside the pack.

Current presets include:
- Node web app + REST + SQLite
- Node web app + GraphQL + SQLite
- Node REST service + SQLite
- Vue 3 + Ant Design Vue + GraphQL + SQLite

The goal is simple: let the LLM spend its context on product logic, data modeling, and failing verifications, not on re-assembling the same boilerplate with slightly different mistakes.

ShipFlow also supports contributed scaffold plugins packaged as `.zip` archives. A scaffold plugin contains:
- a manifest with LLM-facing summary and guidance
- a template payload
- an optional install script that ShipFlow runs inside the target repo
- for `startup` plugins, the archetype's base verification files under `vp/`

There are two plugin classes:
- `startup`: one startup foundation, only for greenfield repos
- `component`: additive slices such as an API, service, database, mobile shell, or TUI layer

Commands:

```bash
shipflow scaffold-plugin install ./my-plugin.zip
shipflow scaffold-plugin list
shipflow scaffold --plugin=my-startup-plugin
shipflow scaffold --component=graphql-api --component=sqlite-db
```

If your team already has a repeatable foundation for a stack, package it and contribute it. ShipFlow gets stronger when common project shapes move out of prompt folklore and into reusable scaffold plugins.

- `startup` plugins give greenfield repos a real foundation on day one.
- `startup` plugins must also ship the base checks that make that foundation real.
- `component` plugins let existing repos grow in deterministic slices.
- The fastest way to make ShipFlow better for a new stack is usually to contribute a scaffold plugin, not another prompt tweak.

See [Scaffold Plugins](./docs/SCAFFOLD-PLUGINS.md) for the archive format, manifest contract, install-script contract, and contribution workflow.

## Implementation Strategy

`shipflow implement` is a bounded multi-agent loop, not one ever-growing agent context.

There are two loops:

1. The outer ShipFlow loop: `implement -> verify -> retry until green or budget exhausted`.
2. The inner planning loop inside each implementation iteration: `strategy lead -> one-shot specialist -> replan -> next one-shot specialist`.

Per implementation iteration:
1. ShipFlow bootstraps the verification runtime and applies a deterministic scaffold when configured or inferred.
2. A strategy lead reads the latest evidence and compact thread state.
3. It selects exactly one next micro-task.
4. ShipFlow invokes exactly one specialist for that micro-task: `architecture`, `ui`, `api`, `database`, `security`, or `technical`.
5. That specialist works in its own clean context, returns after one narrow slice, and either writes files or reports a concrete blocker.
6. The orchestrator replans from the new evidence and can choose the same specialist again later, but only for another one-shot slice.
7. When the strategy lead says the current wave is ready, ShipFlow runs `verify`.
8. If verification is still red, the outer loop starts another implementation iteration. If the run is stagnating, the next strategy must materially change approach.

The important boundary is this: specialists and runner backends do not get to declare success. Only the ShipFlow loop does, after a full `verify` run writes a green `evidence/run.json`.

ShipFlow also writes structured implementation logs while that loop runs, so the orchestrator and each specialist leave a persistent high-level execution trail instead of disappearing into one opaque chat transcript.

The installer wires that to the native surface of each CLI:
- Claude Code: plugin + Task subagents
- Codex CLI: native multi-agent roles + separate specialist runs
- Gemini CLI: extension commands + separate specialist runs
- Kiro CLI: custom agents + skills + steering

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
```

The installer detects Claude Code, Codex CLI, Gemini CLI, and Kiro CLI and installs the native ShipFlow integration for each one it finds, including the multi-agent implementation surface for that CLI.

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/uninstall.sh | bash
```

## Try It

```bash
./scripts/try-todo-example.sh
```

This runs the canonical todo example end to end:
- installs ShipFlow
- enters `examples/todo-app`
- clears `src/`
- runs the normal `shipflow implement` loop against the committed pack

It is the fastest way to see the core claim in action: keep the pack, delete the implementation, rebuild the app.

## Agent Workflow

Initialize ShipFlow in your project:

```bash
shipflow init [--claude|--codex|--gemini|--kiro|--all]
```

Then use the normal flow. **You never hand-author the verification pack** — it is generated from the grill+decision substrate after the team has aligned.

1. **Grill the intent** — `shipflow grill --ai --role=<product|architecture|qa|security|risk> --intent="…"` (or `--multi` for all five lenses at once) surfaces ambiguities, edge cases, and assumptions before any YAML exists. Walk the transcript with the user, capture answers, surface findings.
2. **Capture decisions** — `shipflow decision new` (or `shipflow grill promote` from a session) records each non-obvious call as a durable decision with question/decision/rationale/source.
3. **Generate the verification pack** — `shipflow draft --ai --write` (or `/shipflow:draft` from your AI CLI) reads the grill transcripts and decisions and proposes narrow `vp/**` files that enforce them. Your job is to **review and tighten**, not to write the YAML.
4. **Bind decisions to the generated vp files** — `shipflow decision link <id> --vp=<path>`. `shipflow trace` then joins grill → decision → vp automatically.
5. **Group the work into a slice** — `shipflow slice new` ties intent + decisions + vp + (later) evidence into one user-visible outcome.
6. **Critique** the cognitive quality of the pack — `shipflow critique --threshold=N` flags happy-path-only, missing decision links, vague titles, placeholders. CI-suitable.
7. **Approve** the pack — `shipflow approve-pack` records the human signoff against the current pack hash. Optional gating via `impl.requirePackApproval` makes `implement` refuse to run without it.
8. **Generate, scaffold (optional), implement** — the runnable tests and the deterministic foundation come from the approved pack; `shipflow implement` drives the multi-agent loop until verification is green.
9. **Trace** the audit trail — `shipflow trace --markdown` (or `--pr-comment`) walks intent → grill → decisions → vp → tests → evidence → approval, suitable for PR descriptions.

Brownfield: `shipflow discover` scans the repo and proposes regression VPs for existing surfaces, so refactors cannot silently change behavior the team relied on.

Org policy: `shipflow governance init` scaffolds `.shipflow/governance.yml`; `shipflow governance check` validates the current state of the repo against it (CI-friendly).

For deterministic project setup:

```bash
shipflow scaffold
```

For visual approvals:

```bash
shipflow approve-visual
```

For exact agent commands and debug commands like `map`, `doctor`, `lint`, `critique`, `gen`, `verify`, `status`, `slice`, `preview`, `review-artifact`, `discover`, `trace`, and `governance`, use the docs below.

## Docs

- [User Guide](./docs/USER-GUIDE.md) — commands, workflows, and day-to-day usage
- [Verification Pack](./docs/VERIFICATION-PACK.md) — pack structure, generated outputs, and execution model
- [Scaffold Plugins](./docs/SCAFFOLD-PLUGINS.md) — how to author, package, install, and contribute scaffold plugins
- [Scientific Foundations](./docs/SCIENTIFIC-FOUNDATIONS.md) — why understanding-to-verification-first shipping exists

## Requirements

- `Node.js 18+`
- One AI coding CLI: `Claude Code`, `Codex CLI`, `Gemini CLI`, or `Kiro CLI`

## License

MIT
