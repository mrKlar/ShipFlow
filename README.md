<div align="center">

# ShipFlow

### *Spec-driven development is dead.*<br>Welcome to **understanding-to-verification-first shipping**.

[![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen)](https://nodejs.org)
[![Tests Passing](https://img.shields.io/badge/tests-passing-brightgreen)](#)
[![License MIT](https://img.shields.io/badge/license-MIT-blue)](#license)

</div>

---

You wrote a long PRD. The agent built something. It feels right. You ship it.

It was the wrong thing.

ShipFlow stops that loop.

## What it does

```text
   grill ──▶ decisions ──▶ generate vp ──▶ critique ──▶ approve ──▶ implement ──▶ verify ──▶ trace
   ▲           │                                                          │
   └───────────┴────── locked, signed, auditable substrate ──────────────┘
```

ShipFlow is a framework for AI coding agents that captures **human judgment** as **executable verification**. You never hand the agent a markdown spec and hope it interprets it correctly. Instead:

1. **Grill the intent** with the AI as the fourth Three-Amigo. Surface what the team hasn't agreed on, *before* any YAML exists.
2. **Capture decisions** as durable, sha256-traceable artifacts.
3. **The agent generates the verification pack** from the grill+decision substrate. You review and tighten — never hand-author.
4. **Sign off**, then let ShipFlow drive implementation until every check is green.

The verification pack is the **executable capture of validated understanding**. The code is disposable. The substrate is forever.

## Why this is different

| | Spec-driven (spec-kit, SpecOS, …) | Naive verification-first | **ShipFlow** |
|---|---|---|---|
| Source of truth | Markdown spec | YAML pack | **Validated understanding, captured as YAML** |
| Human judgment | Captured in prose, lost on translation | Skipped | **Captured as grill transcripts + signed decisions** |
| Drift protection | Manual audit | Crypto lock on artifacts | **Crypto lock + sha256-bound human approvals + governance gates** |
| Failure mode | Agent ships wrong outcome with confident YAML | Agent generates a YAML PRD, ships wrong outcome | **Pack cannot be approved without grill, decisions, and a passing critique** |

A pure "verification-first" framing isn't enough either. An AI-generated YAML pack disconnected from human judgment is just an AI-generated PRD with a `.yml` extension. ShipFlow closes that gap with the sensemaking phase up front.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
```

Auto-detects Claude Code, Codex CLI, Gemini CLI, and Kiro CLI. Installs the native multi-agent integration for each.

## Try it in 60 seconds

```bash
./scripts/try-todo-example.sh
```

Installs ShipFlow, enters `examples/todo-app`, **deletes `src/`**, and rebuilds the app from the committed pack alone. Proves the core claim: *keep the pack, delete the implementation, rebuild from constraints.*

## Get started in your project

```bash
shipflow init [--claude|--codex|--gemini|--kiro|--all] [--github-action]
```

Then walk the **[10-minute walkthrough](./docs/USER-GUIDE.md#walkthrough--understanding-to-verification-in-10-minutes)** which takes you through grill → decisions → generated pack → critique → approve → trace, with the actual command output captured at each step.

## What's in the box

- **Substrate** — `shipflow grill` (incl. `--multi` fan-out across 5 specialist lenses), `shipflow decision`, `shipflow slice`, `shipflow review-artifact`
- **Quality + governance** — `shipflow critique --threshold=N` (CI gate), `shipflow approve-pack` (sha256-bound), `shipflow governance check` (org policy)
- **Brownfield** — `shipflow discover` scans existing UI routes, API endpoints, DB tables, auth surfaces; `shipflow discover promote` scaffolds regression VPs
- **Audit + reporting** — `shipflow trace --pr-comment` (GitHub-friendly PR matrix), `shipflow report` (weekly snapshot)
- **Implementation loop** — `shipflow implement` drives bounded multi-agent specialists (architecture, ui, api, database, security, technical) against the locked, signed pack until `shipflow verify` exits 0
- **Migration** — `shipflow migrate` upgrades older repos to the current layout

ShipFlow can lock UI rendering + visual baselines, end-to-end behavior, REST/GraphQL contracts, database invariants, business-domain objects with their data-engineering translation, performance thresholds, security boundaries with OPA policy gates, and technical contracts (CI, deps, architecture).

## Docs

- **[User Guide](./docs/USER-GUIDE.md)** — start here, includes the 10-minute walkthrough
- [Verification Pack reference](./docs/VERIFICATION-PACK.md) — pack structure, substrate, generated outputs, execution
- [Scientific Foundations](./docs/SCIENTIFIC-FOUNDATIONS.md) — the theory behind understanding-to-verification-first
- [Scaffold Plugins](./docs/SCAFFOLD-PLUGINS.md) — package & contribute deterministic foundations

## Requirements

- Node.js 18+
- One AI coding CLI: Claude Code, Codex CLI, Gemini CLI, or Kiro CLI

## License

MIT
