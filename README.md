<div align="center">

# 🚢 ShipFlow

### *Spec-driven development is dead.*<br>Welcome to **verification-first**.

<br>

[![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen)](https://nodejs.org)
[![Tests Passing](https://img.shields.io/badge/tests-passing-brightgreen)](#)
[![License MIT](https://img.shields.io/badge/license-MIT-blue)](#license)

</div>

---

Every "AI-powered" development framework makes the same fundamental mistake: **they imitate the human process.** Write a spec, hand it off, build to spec, review. They bolt AI onto a workflow designed for humans — and wonder why it feels like driving a Tesla with horse reins.

This is a **first-principles failure.** If you have an agent that can write, test, and iterate at machine speed, why are you still asking it to follow a human playbook?

> 🚀 **ShipFlow starts from zero.** No specs. No handoffs. You describe what the app must do, you and the AI shape executable verifications together, ShipFlow generates real tests and harnesses, and the AI implements against that reviewed pack. The process isn't *assisted by* AI — it's **designed for** AI.

```
 You describe        Human + AI refine       ShipFlow generates        AI builds & loops
"a calculator" ──▶  vp/**/*.yml         ──▶  tests + harnesses      ──▶  src/**  ──▶  ✅ reviewed pack enforced
```

🔒 The AI is **constrained by the pack** — cryptographic locks and runtime hooks prevent it from modifying the protected verifications and generated artifacts during implementation. To finish the loop, it has to satisfy the reviewed checks with working code.

---

<div align="center">

## 🗑️ Delete Everything. Regenerate Anytime.

### Your code is **disposable**. Your verifications are **permanent**.

</div>

> If the implementation drifts, you can reset the working code and rerun `shipflow implement`. The verification pack stays the source of truth, and the generated tests keep the rebuild honest.

---

## ⚡ Why ShipFlow — not [spec-kit](https://github.com/github/spec-kit)

| | Spec-driven *(spec-kit)* | Verification-first *(ShipFlow)* |
|---|---|---|
| 📝 | Specs are **documents** the AI reads | Verifications **compile to real tests** |
| ✅ | AI says "done" and you hope it is right | AI cannot finish until `shipflow verify` **exits 0** |
| 🔐 | Nothing stops the AI from ignoring the spec | Cryptographic locks + hooks keep the reviewed pack enforced |
| 🧪 | No test generation; you test manually after | Auto-generated tests: UI, API, database, behavior, security, load |
| 🔄 | Specs drift with no enforcement mechanism | Lock file + SHA-256 hashes detect divergence |
| 🗑️ | Rewrite means restarting the whole spec process | Regenerate from the reviewed verifications in minutes |
| 🔁 | Linear: specify → plan → tasks → implement | Pack-controlled loop: generate → implement → verify → repeat |
| 🤖 | Human workflow adapted for AI | Process designed from scratch for AI agents |

---

## ⚡ Install — One Command, Fully Automatic

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
```

That's it. The installer **auto-detects** the supported AI coding CLIs on your machine and **installs native integrations** for each one.

### What gets installed automatically

| Platform | What the installer does |
|---|---|
| ![Claude Code](https://img.shields.io/badge/Claude_Code-da7756?style=flat-square&logo=claude&logoColor=white) | Installs the ShipFlow **plugin** + anti-cheat hooks |
| ![Codex CLI](https://img.shields.io/badge/Codex_CLI-000000?style=flat-square&logoColor=white) | Installs **skills** + exec policy rules + global instructions |
| ![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-8E75B2?style=flat-square&logo=googlegemini&logoColor=white) | Installs **extension** + BeforeTool guard hooks |
| ![Kiro CLI](https://img.shields.io/badge/Kiro_CLI-a855f7?style=flat-square&logoColor=white) | Installs **skills** + steering context + guard hooks |

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/uninstall.sh | bash
```

Cleanly removes the ShipFlow plugin, skills, extension, hooks, steering context, and global package.

---

## 🚀 Agent Flow

Open your project in your AI coding agent and use its native ShipFlow integration:

| | Draft the verification pack together | Run the standard loop |
|---|---|---|
| ![Claude Code](https://img.shields.io/badge/Claude_Code-da7756?style=flat-square&logo=claude&logoColor=white) | `/shipflow-verifications a todo app` | `/shipflow-implement` |
| ![Codex CLI](https://img.shields.io/badge/Codex_CLI-000000?style=flat-square&logoColor=white) | `$shipflow-verifications a todo app` | `$shipflow-implement` |
| ![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-8E75B2?style=flat-square&logo=googlegemini&logoColor=white) | `/shipflow:verifications a todo app` | `/shipflow:implement` |
| ![Kiro CLI](https://img.shields.io/badge/Kiro_CLI-a855f7?style=flat-square&logoColor=white) | `draft ShipFlow verifications for a todo app` | `run shipflow implement against the reviewed verification pack` |

**Step 1** — Human + AI draft the verification pack together. Review it, tighten it, and fill the missing coverage.

**Step 2** — Run `shipflow implement`. It validates the pack, generates the runnable tests/harnesses, implements, verifies, and retries within the configured budget until the required checks pass or the loop fails.

---

## 🔬 How It Works

### Phase 1 — ✏️ Verification

You and the AI draft **executable YAML** that defines the observable behaviors your app must have.

```yaml
# vp/ui/add-numbers.yml
flow:
  - open: /
  - click: { testid: btn-2 }
  - click: { testid: btn-plus }
  - click: { testid: btn-3 }
  - click: { testid: btn-equals }
assert:
  - text_equals: { testid: display, equals: "5" }
```

### Phase 2 — 🤖 Implementation

AI reads the pack, generates the runnable tests and harnesses, writes application code, and **repeats within the configured budget until the required checks pass or the loop stops with failures.**

```
Read VP  →  Generate tests  →  Implement  →  Verify  →  ✅ Pass? Done.
                                    ↑                       ↓
                                    └──── 🔁 Fix & retry ──┘
```

### 🔒 The Anti-Cheat System

ShipFlow makes it **structurally difficult to game the loop** via SHA-256 hashes and runtime hooks blocking writes to protected paths (`vp/`, `.gen/`, `evidence/`).

---

## 🌐 Native Integration — Not a Wrapper

ShipFlow does not just support AI agents. It installs native integrations that speak each platform's language:

| Platform | Integration type | Anti-cheat mechanism |
|---|---|---|
| ![Claude Code](https://img.shields.io/badge/Claude_Code-da7756?style=flat-square&logo=claude&logoColor=white) | Plugin (slash commands + agents) | PreToolUse + Stop hooks |
| ![Codex CLI](https://img.shields.io/badge/Codex_CLI-000000?style=flat-square&logoColor=white) | Skills (`$skill` invocation) | Sandbox + exec policy rules |
| ![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-8E75B2?style=flat-square&logo=googlegemini&logoColor=white) | Extension (slash commands + context) | BeforeTool guard hooks |
| ![Kiro CLI](https://img.shields.io/badge/Kiro_CLI-a855f7?style=flat-square&logoColor=white) | Skills (auto-activated) + steering | PreToolUse guard hooks |

Every integration includes the verification schema, the implementation-loop instructions, and platform-specific pack protection.

---

## 📋 Seven Verification Types + Policy Gates

| | Type | Path | What it tests |
|---|---|---|---|
| 🖥️ | **UI Checks** | `vp/ui/*.yml` | Browser interactions and visual assertions |
| 📖 | **Behavior Checks** | `vp/behavior/*.yml` | Given/When/Then scenarios across web, API, or TUI surfaces, with Playwright-backed or Cucumber/Gherkin execution |
| 🌐 | **API Checks** | `vp/api/*.yml` | HTTP request/response behavior |
| 🗄️ | **Database Checks** | `vp/db/*.yml` | Database state (SQLite, PostgreSQL) |
| ⚡ | **Performance Checks** | `vp/nfr/*.yml` | Performance under load (k6) |
| 🔐 | **Security Checks** | `vp/security/*.yml` | Auth, authz, headers, exposure |
| 🏗️ | **Technical Checks** | `vp/technical/*.yml` | Frameworks, architecture, CI, infra, tooling |
| 📜 | **Policy Gates** | `vp/policy/*.rego` | Organizational rules via OPA |

Plus 🧩 **fixtures** (`vp/ui/_fixtures/*.yml`) for reusable setup flows.

---

## 📁 Project Structure

```text
your-app/
├── vp/                         # Verifications you review
│   ├── ui/*.yml
│   ├── behavior/*.yml
│   ├── api/*.yml
│   ├── db/*.yml
│   ├── nfr/*.yml
│   ├── security/*.yml
│   ├── technical/*.yml
│   ├── policy/*.rego
│   └── ui/_fixtures/*.yml
├── .gen/                       # Generated tests and harnesses
│   ├── playwright/*.test.ts
│   ├── cucumber/
│   │   ├── features/*.feature
│   │   └── step_definitions/*.steps.mjs
│   ├── k6/*.js
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

## 🛠️ CLI

```bash
shipflow init [--claude|--codex|--gemini|--kiro|--all]  # Set up ShipFlow for the detected or selected CLI
shipflow draft [description] [--write] [--ai]           # Standard flow: co-draft the verification pack
shipflow implement                                      # Standard flow: validate, generate, implement, verify

# Advanced / debug
shipflow map [description]                              # Review repo surfaces and coverage gaps
shipflow doctor                                         # Check local tools, runners, and adapters
shipflow lint                                           # Lint verification quality
shipflow gen                                            # Generate runnable tests from the pack
shipflow verify                                         # Run generated tests and write evidence
shipflow status                                         # Show pack, generated tests, and evidence
shipflow implement-once                                 # Single implementation pass, no retry loop
```

### Recommended Verification Frameworks

ShipFlow now has a practical default per verification type:

| Type | Default | Strong alternates |
|---|---|---|
| UI | Playwright | |
| Behavior | Cucumber + surface executors | Playwright web, Playwright request, node PTY |
| API | Playwright request | Pactum |
| Database | Built-in SQL harness | pgTAP (PostgreSQL) |
| Performance | k6 | |
| Security | Playwright request | OWASP ZAP |
| Technical | Built-in repo inspection + command checks | dependency-cruiser, tsarch, madge, eslint-plugin-boundaries |

### Example Technical Checks

```yaml
# vp/technical/architecture-boundaries.yml
id: technical-architecture-boundaries
title: Domain layer stays isolated from UI
severity: blocker
category: architecture
runner:
  kind: archtest
  framework: tsarch
app:
  kind: technical
  root: .
assert:
  - imports_forbidden: { files: "src/domain/**/*.ts", patterns: ["src/ui/", "react"] }
  - command_succeeds: { command: "npx tsarch --help" }
```

See `examples/api-db-service/vp/technical/architecture-boundaries.yml` for a fuller layered-service example. The same `archtest` pattern also works with `dependency-cruiser`, `madge`, or `eslint-plugin-boundaries`.

```yaml
# vp/technical/ci-stack.yml
id: technical-ci-stack
title: Repository uses GitHub Actions and Playwright
severity: blocker
category: ci
runner:
  kind: custom
  framework: custom
app:
  kind: technical
  root: .
assert:
  - path_exists: { path: ".github/workflows/ci.yml" }
  - dependency_present: { name: "@playwright/test", section: devDependencies }
  - github_action_uses: { workflow: ".github/workflows/ci.yml", action: "actions/checkout@v4" }
```

## ⚙️ Configuration

```json
{
  "draft": {
    "provider": "local",
    "aiProvider": "auto"
  },
  "impl": {
    "provider": "auto",
    "maxTokens": 16384,
    "historyLimit": 50,
    "srcDir": "src",
    "writeRoots": [".github/workflows", "infra"],
    "context": "Node.js HTTP server, no frameworks"
  }
}
```

`provider: "auto"` resolves to the active local CLI integration when possible (`claude`, `codex`, `gemini`, or `kiro`), and falls back to the API provider/runtime defaults when needed. `shipflow implement` always allows the configured `srcDir`, derives extra repo-level write targets from `vp/technical/*.yml` when needed, and can be widened explicitly with `impl.writeRoots`.

## 🔄 CI

```yaml
name: ShipFlow Verify
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: shipflow gen
      - run: shipflow verify
```

---

## 🔬 The Evolution of Software Engineering

ShipFlow implements a **Verification-First** paradigm. Unlike Spec-Driven frameworks (spec-kit, SpecOS) that focus on instructions, ShipFlow focuses on **constraints**.

| Dimension | Classical SE (1.0) | Spec-Driven (spec-kit / SpecOS) | Verification-First (ShipFlow 2.0) | Scientific Value |
| :--- | :--- | :--- | :--- | :--- |
| **Source of Truth** | Implementation (Code) | Documentation (Markdown) | Verification (YAML) | Elimination of semantic ambiguity. |
| **Primary Artifact** | Source Files | Spec Files (`spec.md`) | Executable Contracts (`vp/*.yml`) | Shift to machine-readable intent. |
| **Review Process** | Code Review (Human) | Spec Review (Human) | Verification Review (Human) | Intent-based validation vs. syntax check. |
| **Verification Loop** | Human-led TDD | AI-led (Loose coupling) | Collaborative draft + locked loop | Exponential acceleration of feedback. |
| **Drift Protection** | Manual Tests / CI | Manual Audit | Cryptographic Lock / Anti-Cheat | Guaranteed lifecycle integrity. |
| **Code Nature** | Permanent (The Asset) | Semi-permanent | Disposable (The Artifact) | Elimination of technical debt by design. |

> For a deeper dive into the theoretical principles, see [SCIENTIFIC-FOUNDATIONS.md](./docs/SCIENTIFIC-FOUNDATIONS.md).

---

<div align="center">

### 📋 Requirements

**Node.js 18+** · ![Claude Code](https://img.shields.io/badge/Claude_Code-da7756?style=flat-square&logo=claude&logoColor=white) or ![Codex CLI](https://img.shields.io/badge/Codex_CLI-000000?style=flat-square&logoColor=white) or ![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-8E75B2?style=flat-square&logo=googlegemini&logoColor=white) or ![Kiro CLI](https://img.shields.io/badge/Kiro_CLI-a855f7?style=flat-square&logoColor=white)

<br>

*Built for the age of AI coding agents.*<br>
*Stop writing specs. Start shipping.*

<br>

**MIT License**

</div>
