<div align="center">

# ShipFlow

### *Spec-driven development is dead.*<br>Welcome to **verification-first shipping**.

[![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen)](https://nodejs.org)
[![Tests Passing](https://img.shields.io/badge/tests-passing-brightgreen)](#)
[![License MIT](https://img.shields.io/badge/license-MIT-blue)](#license)

</div>

ShipFlow is a framework for AI coding agents. You do not hand the agent a long spec and hope it interprets it correctly. You define what must be observably true when the work is done, ShipFlow turns that into executable verification, locks the boundary, and drives implementation until the checks pass.

```text
Define outcomes  ->  Draft the pack  ->  Generate tests/runners  ->  Implement until green
```

The code is disposable. The verification pack is the durable artifact.

## Why ShipFlow

Most AI dev workflows still follow a human process:
- write a spec
- break it into tasks
- let the agent implement
- trust the claim that it is done

ShipFlow replaces that with a locked verification boundary:
- real UI, behavior, API, database, technical, and domain checks
- generated tests and runners from the pack itself
- cryptographic locks and runtime hooks to stop pack drift during implementation
- an implementation loop that ends on verification, not on vibes

## What It Can Lock

- Visual UI contracts: layout, placement, spacing, styles, tokens, approved baselines, and screenshot diffs.
- Behavior contracts: what users or clients can actually do end to end.
- API contracts: request and response behavior, including negative cases.
- Database invariants: before and after state, not just HTTP output.
- Business domain contracts: business objects, identities, references, invariants, access patterns, and the data-engineering translation into storage, read, write, and exchange models.
- Technical boundaries: runtime pinning, stack choices, protocols, CI, tooling, and architecture rules.

ShipFlow also understands the shape of the product it is drafting for. It can propose different baseline bundles for frontend apps, fullstack apps, REST backend services, and CLI/TUI apps. For UI-heavy projects, it can also steer greenfield work toward a mainstream open-source design-system library instead of an ad hoc local kit.

## How It Works

1. Define what must be true when the work is done.
2. Turn that into a verification pack under `vp/`.
3. Let ShipFlow generate real tests and runners.
4. Let the agent implement until verification is green.

That boundary can go beyond UI and API output.
- For stateful systems, ShipFlow can lock the business domain itself and the required data-engineering translation into technical data objects.
- For UI-heavy systems, ShipFlow can lock approved visual baselines and produce `expected`, `actual`, and `diff` artifacts.
- For backend services, ShipFlow can keep API, database, and technical reality in scope together, including DB-backed and multi-API REST services.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
```

The installer detects Claude Code, Codex CLI, Gemini CLI, and Kiro CLI and installs the native ShipFlow integration for each one it finds.

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

Then use the normal flow:

1. Draft and finalize the verification pack.
2. Generate the runnable artifacts.
3. Run the implementation loop.

For visual approvals:

```bash
shipflow approve-visual
```

For exact agent commands and debug commands like `map`, `doctor`, `lint`, `gen`, `verify`, and `status`, use the docs below.

## Docs

| User Guide | Verification Pack | Scientific Foundations |
|---|---|---|
| [How to write verifications, commands, and workflows](./docs/USER-GUIDE.md) | [Pack structure, generated outputs, and execution model](./docs/VERIFICATION-PACK.md) | [Why verification-first shipping exists](./docs/SCIENTIFIC-FOUNDATIONS.md) |

## Requirements

- `Node.js 18+`
- One AI coding CLI: `Claude Code`, `Codex CLI`, `Gemini CLI`, or `Kiro CLI`

## License

MIT
