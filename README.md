<div align="center">

# 🚢 ShipFlow

### *Spec-driven development is dead.*<br>Welcome to **verification-first shipping**.

<br>

[![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen)](https://nodejs.org)
[![Tests Passing](https://img.shields.io/badge/tests-passing-brightgreen)](#)
[![License MIT](https://img.shields.io/badge/license-MIT-blue)](#license)

</div>

---

Every "AI-powered" development framework makes the same fundamental mistake: it imitates the human process. Write a spec, hand it off, build to spec, review. It bolts AI onto a workflow designed for humans and then wonders why it feels like driving a Tesla with horse reins.

This is a first-principles failure. If you have an agent that can write, test, and iterate at machine speed, why are you still asking it to follow a human playbook?

> 🚀 **ShipFlow starts from zero.** No specs. No handoffs. You define what must be true when the work is done, you and/or the AI shape executable verifications, ShipFlow generates real tests and runners, and the AI implements against that locked pack. The process is not assisted by AI. It is designed for AI.

```text
 You define outcomes     Draft / finalize        ShipFlow generates      AI builds & loops
"2+3 returns 5" ──▶    vp/**/*.yml         ──▶  tests + runners     ──▶  src/**  ──▶  ✅ locked pack enforced
```

🔒 The AI cannot win by editing the pack out from under the loop. Cryptographic locks and runtime hooks protect the verification pack and generated artifacts during implementation. The only way out is working code.

It also means ShipFlow is not trapped in toy demos. It understands the shape of the thing you are building and drafts the right boundary:
- frontend web apps
- fullstack web apps
- REST backend services
- CLI and TUI apps

That REST service support is not just "an endpoint exists." ShipFlow can now treat database-backed services and multi-API orchestration services as first-class products, then pull the right baseline bundle into the pack automatically.
For stateful products, that boundary can also include the business domain itself: the core business objects, their identities, references, invariants, access patterns, and the data-engineering step that turns them into storage, read, write, and exchange models.

## 📚 Docs

| README | User Guide | Verification Pack | Scientific Foundations |
|---|---|---|---|
| You are here | [How to write verifications, commands, and workflows](./docs/USER-GUIDE.md) | [Pack structure, generated outputs, and execution model](./docs/VERIFICATION-PACK.md) | [Why verification-first shipping exists](./docs/SCIENTIFIC-FOUNDATIONS.md) |

## 🗑️ Delete Everything. Regenerate Anytime.

Your code is disposable. Your verifications are permanent.

If the implementation drifts, you can reset the working code and rerun `shipflow implement`. The verification pack stays the source of truth, and the generated tests keep the rebuild honest.

## ⚡ Why ShipFlow

Most AI dev workflows still look like human workflows:
- write a spec
- turn it into plans and tasks
- let the agent implement
- hope the result matches the spec

ShipFlow replaces that with one durable artifact: the verification pack.

- The pack records what must be true, visible, accepted, rejected, or preserved.
- ShipFlow turns that pack into real tests and runners.
- The agent implements against that locked boundary.
- The loop ends only when verification is green.

Now that boundary can reach further than before:
- visual UI contracts for layout, placement, styles, and screenshot diffs
- business-domain objects and technical data objects for stateful systems
- runtime pinning for the verification environment itself
- mainstream open-source design-system defaults instead of accidental one-off UI kits
- backend-service bundles that cover API, database, and upstream dependency reality together

That is what makes ShipFlow feel less like "AI coding with guardrails" and more like a real shipping system.

## ⚡ Install — One Command, Fully Automatic

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
```

That is it. The installer detects Claude Code, Codex CLI, Gemini CLI, and Kiro CLI on your machine and installs the native ShipFlow integration for each one it finds.

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/uninstall.sh | bash
```

Removes the global integrations and the global `shipflow` install.

## TRY ME!

Clone the repo, enter it, then run exactly this:

```bash
./scripts/try-todo-example.sh
```

That single command:

- installs ShipFlow
- enters the canonical example under `examples/todo-app`
- resets `src/` to an empty state
- runs the normal `shipflow implement` loop against the committed pack

It is the fastest way to prove the core claim: delete the implementation, keep the verification pack, and ShipFlow rebuilds the app from the pack.

## 🎯 What ShipFlow Can Lock

ShipFlow is built to define the finished state in executable terms, not just the happy path.

- **Visual UI contracts**: verify layout, alignment, spacing, styles, tokens, and locked snapshots with diff artifacts.
- **Behavior contracts**: verify what users or clients can actually do end to end.
- **Business domain contracts**: define the business objects, references, invariants, and data objects the system must support before implementation choices harden.
- **API contracts**: lock public request/response behavior, including negative cases.
- **Database invariants**: verify before/after state, not just HTTP output.
- **Technical boundaries**: pin runtimes, stack choices, protocols, CI, architecture, and required tooling.

For stateful or integration-heavy systems, that business-domain layer is where ShipFlow makes the hard part explicit: not just "there is a table" or "there is an endpoint," but which business objects exist, what must stay true about them, and how they are translated into technical data objects for persistence, reads, writes, and exchanges.

For UI-heavy projects, ShipFlow can also draft a sane open-source design-system default when the repo has none yet. Instead of improvising a button library from scratch, it can steer the project toward widely used choices like MUI, Ant Design, Chakra UI, Vuetify, Angular Material, or Skeleton, depending on the stack and product shape.

## 🚀 Agent Flow

In your project, scaffold ShipFlow:

```bash
shipflow init [--claude|--codex|--gemini|--kiro|--all]
```

Then use the normal flow in your AI CLI:

1. Start the draft flow in your AI CLI.
2. Finalize the verification pack.
3. Run the implement flow.

That is it: define the pack, then implement against it.

For the exact Claude / Codex / Gemini / Kiro commands, plus debug commands like `map`, `doctor`, `lint`, `gen`, `verify`, and `status`, use the [User Guide](./docs/USER-GUIDE.md#agent-workflow).

## 🔬 How It Works

1. You define what must be observably true when the work is done.
2. You and/or the AI turn that into a verification pack.
3. ShipFlow turns that pack into real tests and runners.
4. The AI implements until the required checks pass.

That is the core idea: define the finished-state checks in executable terms, lock them, and let the agent implement against them.

For stateful systems, those checks are not limited to UI, API, and database output. ShipFlow can also lock the business domain itself: the domain objects, their identities and references, their invariants and access patterns, and the required data-engineering translation into technical data objects such as canonical storage models, read models, write models, and API exchange models.

On a new project, that boundary includes the verification environment itself. ShipFlow can draft technical starters that pin the initial runtime and declared stack, so Node, package manager, and dependency-spec drift become explicit pack changes instead of ambient machine-state surprises.

For modern UI work, that boundary can also include visual contracts. ShipFlow can generate Playwright-powered visual checks, lock approved baselines under `vp/ui/_baselines/`, and produce `expected` / `actual` / `diff` evidence when a regression shows up. Approving a new intended look is explicit with:

```bash
shipflow approve-visual
```

For backend work, ShipFlow can recognize a pure REST service, including services that persist data or fan out across multiple upstream APIs, and keep API, database, and technical checks in scope together instead of pretending a single endpoint check is enough.

Why believe it? Because ShipFlow locks the verification pack and generated artifacts before implementation, and the loop ends on verification, not on a claim that the work is “done”.

If you want the exact file formats, generated outputs, lock semantics, or command reference, use the docs:
- [User Guide](./docs/USER-GUIDE.md)
- [Verification Pack](./docs/VERIFICATION-PACK.md)
- [Scientific Foundations](./docs/SCIENTIFIC-FOUNDATIONS.md)

## 📋 Requirements

- `Node.js 18+`
- One AI coding CLI: `Claude Code`, `Codex CLI`, `Gemini CLI`, or `Kiro CLI`

---

**Built for the age of AI coding agents.**
Stop writing specs. Start shipping.

## License

MIT
