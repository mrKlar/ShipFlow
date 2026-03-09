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

> 🚀 **ShipFlow starts from zero.** No specs. No handoffs. You describe what the app must do, you and/or the AI shape executable verifications, ShipFlow generates real tests and runners, and the AI implements against that locked pack. The process is not assisted by AI. It is designed for AI.

```text
 You describe        Draft / finalize        ShipFlow generates      AI builds & loops
"a calculator" ──▶  vp/**/*.yml         ──▶  tests + runners     ──▶  src/**  ──▶  ✅ locked pack enforced
```

🔒 The AI cannot win by editing the pack out from under the loop. Cryptographic locks and runtime hooks protect the verification pack and generated artifacts during implementation. The only way out is working code.

## 📚 Docs

| README | User Guide | Verification Pack | Scientific Foundations |
|---|---|---|---|
| You are here | [How to write verifications, commands, and workflows](./docs/USER-GUIDE.md) | [Pack structure, generated outputs, and execution model](./docs/VERIFICATION-PACK.md) | [Why verification-first shipping exists](./docs/SCIENTIFIC-FOUNDATIONS.md) |

## 🗑️ Delete Everything. Regenerate Anytime.

Your code is disposable. Your verifications are permanent.

If the implementation drifts, you can reset the working code and rerun `shipflow implement`. The verification pack stays the source of truth, and the generated tests keep the rebuild honest.

## ⚡ Why ShipFlow — not [spec-kit](https://github.com/github/spec-kit)

| | Spec-driven *(spec-kit)* | Verification-first *(ShipFlow)* |
|---|---|---|
| 📝 | Specs are documents the AI reads | Verifications compile to real tests |
| ✅ | AI says "done" and you hope it is right | AI cannot finish until `shipflow verify` exits `0` |
| 🔐 | Nothing stops the AI from ignoring the spec | Cryptographic locks + hooks keep the locked pack enforced |
| 🧪 | No test generation; you test manually after | Auto-generated tests: UI, behavior, API, database, load, security, technical |
| 🔄 | Specs drift with no enforcement mechanism | Lock file + SHA-256 hashes detect divergence |
| 🗑️ | Rewrite means restarting the whole spec process | Regenerate from the verification pack in minutes |
| 🔁 | Linear: specify → plan → tasks → implement | Pack-controlled loop: draft → generate → implement → verify → repeat |
| 🤖 | Human workflow adapted for AI | Process designed from scratch for AI agents |

## ⚡ Install — One Command, Fully Automatic

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
```

That is it for the global install. The installer auto-detects the supported AI coding CLIs on your machine and installs their global ShipFlow integrations: plugin, skills, extension, rules, guards, and instructions.

### What gets installed automatically

| Platform | What the installer does |
|---|---|
| Claude Code | Installs the ShipFlow plugin globally |
| Codex CLI | Installs skills + exec policy rules + global instructions |
| Gemini CLI | Installs extension + write/shell guard hooks |
| Kiro CLI | Installs skills + steering + project guard hooks |

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/uninstall.sh | bash
```

Removes the global ShipFlow integrations, symlinks, steering context, and global package. Project files created by `shipflow init` stay in your repo until you remove them yourself.

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

## 🚀 Agent Flow

In your project:

```bash
shipflow init [--claude|--codex|--gemini|--kiro|--all]
```

Then use the normal flow:

1. Start the draft flow in your AI CLI.
2. Finalize the verification pack.
3. Run the implement flow.

That is it: define the pack, then implement against it.

For the exact Claude / Codex / Gemini / Kiro commands, plus debug commands like `map`, `doctor`, `lint`, `gen`, `verify`, and `status`, use the [User Guide](./docs/USER-GUIDE.md#agent-workflow).

## 🔬 How It Works

### Phase 1 — ✏️ Verification

You describe what you want. You and the AI draft a verification pack under `vp/`. That pack is the contract: executable checks across UI, behavior, API, database, performance, security, technical constraints, and policy.

The README stays high-level on purpose. For the YAML shapes, per-type examples, and verification-writing rules, use the [User Guide](./docs/USER-GUIDE.md#writing-verifications).

### Phase 2 — 🤖 Implementation

AI-led, pack-controlled. Once the verification pack is finalized, the AI reads it, generates runnable tests and backends, writes application code, runs the checks, reads failures, fixes the code, and repeats until every required check passes or the retry budget is exhausted.

```text
Read VP  →  Generate tests  →  Implement  →  Verify  →  ✅ Pass? Done.
                                    ↑                       ↓
                                    └──── 🔁 Fix & retry ──┘
```

### 🔒 The Anti-Cheat System

ShipFlow makes it structurally difficult for the AI to game the loop:

| Mechanism | What it does |
|---|---|
| 🛡️ Path protection | Hooks block writes to `vp/`, `.gen/`, and `evidence/` during implementation |
| 🔐 Cryptographic lock | SHA-256 hashes of the verification pack and generated artifacts are checked before execution |
| 🚫 Stop gate | Native integrations should not report success until `shipflow verify` is green |
| 🧪 Mutation guards | Generated tests include false-positive checks so a trivial passthrough implementation does not satisfy the pack by accident |

The only way the AI can succeed is by writing code that actually works.

## 🌐 Native Integration — Not a Wrapper

ShipFlow does not just "support" AI agents. It installs native integrations that speak each platform's language:

| Platform | Integration type | Anti-cheat mechanism |
|---|---|---|
| Claude Code | Plugin (slash commands + agents) | PreToolUse + Stop hooks |
| Codex CLI | Skills (`$skill`) | Sandbox + exec policy rules |
| Gemini CLI | Extension (slash commands + context) | Write + shell guard hooks |
| Kiro CLI | Skills + steering | Write + shell guard hooks |

Every integration includes the verification schema, the draft workflow, the implementation loop instructions, and platform-specific pack protection.

## 📋 Seven Verification Types + Policy Gates

| Type | Path | What it tests |
|---|---|---|
| UI Checks | `vp/ui/*.yml` | Browser interactions and visual assertions |
| Behavior Checks | `vp/behavior/*.yml` | Given/When/Then scenarios across web, API, or TUI surfaces |
| API Checks | `vp/api/*.yml` | HTTP request/response contracts |
| Database Checks | `vp/db/*.yml` | Database state and data lifecycle |
| Performance Checks | `vp/nfr/*.yml` | Performance under load |
| Security Checks | `vp/security/*.yml` | Auth, authz, headers, exposure |
| Technical Checks | `vp/technical/*.yml` | Frameworks, architecture, CI, infra, tooling, protocol constraints |
| Policy Gates | `vp/policy/*.rego` | Organizational rules via OPA |

Plus fixtures under `vp/ui/_fixtures/*.yml` for reusable setup flows.

For the concrete file formats, assertion keys, runners, and examples, use the [User Guide](./docs/USER-GUIDE.md#writing-verifications).

## 🧪 Canonical Greenfield Example

[`examples/todo-app`](./examples/todo-app) is the single canonical example:

- browser UI at `/`
- REST API under `/api/todos`
- SQLite persistence at `./test.db`
- committed pack under `vp/`
- committed generated runners under `.gen/`
- committed draft session under `.shipflow/`
- real no-fake live harness for Claude Code in [`run-claude-live.mjs`](./examples/todo-app/run-claude-live.mjs)

The example is there to prove the disposable-code claim: you can keep `src/` empty or delete it entirely, then rerun `shipflow implement` and rebuild the app from the locked pack. The live harness creates a temporary project, runs `init -> draft -> finalize -> write -> implement`, and uses the real Claude CLI. It does not fake the provider loop.

Technical checks cover more than architecture boundaries. They can enforce framework choice, GraphQL vs REST, CI and infrastructure files, required SaaS/testing tooling, and repository-level delivery constraints.

## 📁 Project Structure

```text
your-app/
├── vp/                         # Verification pack you define
│   ├── ui/*.yml
│   ├── behavior/*.yml
│   ├── api/*.yml
│   ├── db/*.yml
│   ├── nfr/*.yml
│   ├── security/*.yml
│   ├── technical/*.yml
│   ├── policy/*.rego
│   └── ui/_fixtures/*.yml
├── .gen/                       # Generated tests and runners
│   ├── playwright/*.test.ts
│   ├── cucumber/
│   ├── k6/*.js
│   ├── technical/*.runner.mjs
│   ├── playwright.config.mjs
│   └── manifest.json
├── evidence/                   # Verification results
│   ├── run.json
│   ├── implement.json
│   ├── implement-history.json
│   ├── policy.json
│   ├── ui.json / api.json / security.json ...
│   └── load.json
├── src/                        # App code written during the implementation loop
└── shipflow.json               # Config
```

Need the exact semantics of those directories, generated outputs, and locks? See [Verification Pack](./docs/VERIFICATION-PACK.md).

## 🛠️ CLI

```bash
shipflow init [--claude|--codex|--gemini|--kiro|--all]  # Set up ShipFlow for the detected or selected CLI
shipflow draft [description] [--write] [--ai]           # Standard flow: co-draft the verification pack
shipflow implement                                      # Standard flow: bootstrap, validate, generate, implement, verify

# Advanced / debug
shipflow map [description]                              # Review repo surfaces and coverage gaps
shipflow doctor                                         # Check local tools, runners, and adapters
shipflow lint                                           # Lint verification quality
shipflow gen                                            # Generate runnable tests from the pack
shipflow verify                                         # Run generated tests and write evidence
shipflow status                                         # Show pack, generated tests, evidence, and draft readiness
shipflow implement-once                                 # Single implementation pass, no retry loop
```

## ⚙️ Configuration

`shipflow.json` configures draft and implementation providers, runtime bootstrap, source roots, and allowed write targets.

Use the [User Guide configuration section](./docs/USER-GUIDE.md#configuration) for the full shape and examples.

## 🔬 Scientific Foundations

ShipFlow is built around the idea that the durable artifact is not the source code and not a prose spec, but the executable contract fixed before implementation. The deeper rationale is documented in [docs/SCIENTIFIC-FOUNDATIONS.md](./docs/SCIENTIFIC-FOUNDATIONS.md).

## 📋 Requirements

- `Node.js 18+`
- One AI coding CLI: `Claude Code`, `Codex CLI`, `Gemini CLI`, or `Kiro CLI`

---

**Built for the age of AI coding agents.**
Stop writing specs. Start shipping.

## License

MIT
