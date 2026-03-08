<div align="center">

# 🚢 ShipFlow

### *Spec-driven development is dead.*<br>Welcome to **verification-first**.

<br>

[![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen)](https://nodejs.org)
[![183 tests](https://img.shields.io/badge/tests-183%20passing-brightgreen)](#)
[![License MIT](https://img.shields.io/badge/license-MIT-blue)](#license)

</div>

---

Every "AI-powered" development framework makes the same fundamental mistake: **they imitate the human process.** Write a spec, hand it off, build to spec, review. They bolt AI onto a workflow designed for humans — and wonder why it feels like driving a Tesla with horse reins.

This is a **first-principles failure.** If you have an agent that can write, test, and iterate at machine speed, why are you still asking it to follow a human playbook?

> 🚀 **ShipFlow starts from zero.** No specs. No handoffs. You describe what the app must do, you and the AI shape executable verifications together, ShipFlow generates real tests, and the AI implements against that reviewed pack. The process isn't *assisted by* AI — it's **designed for** AI.

```
 You describe        Human + AI refine       ShipFlow generates      AI builds & loops
"a calculator" ──▶  vp/**/*.yml         ──▶  .gen/playwright/*.ts  ──▶  src/**  ──▶  ✅ reviewed pack enforced
```

🔒 The AI **cannot cheat** — cryptographic locks and runtime hooks make it impossible to modify the verifications or tests during implementation. The only way out is **working code**.

---

<div align="center">

## 🗑️ Delete Everything. Regenerate Anytime.

### Your code is **disposable**. Your verifications are **permanent**.

</div>

> Don't like the implementation? `rm -rf src/ && shipflow implement` — the AI rebuilds the entire app from scratch, guaranteed to pass every verification. **Legacy code doesn't exist** when you can regenerate on demand. No more "don't touch that, nobody knows how it works." No more drift. No more tech debt that compounds for years. Your verifications are the single source of truth — the code is just a **replaceable artifact**.

---

## ⚡ Why ShipFlow — not [spec-kit](https://github.com/github/spec-kit)

| | Spec-driven *(spec-kit)* | Verification-first *(ShipFlow)* |
|---|---|---|
| 📝 | Specs are **documents** the AI reads | Verifications **compile to real tests** |
| ✅ | AI says "done" — you hope it's right | AI can't finish until `shipflow verify` **exits 0** |
| 🔐 | Nothing stops the AI from ignoring the spec | Cryptographic locks + hooks make cheating **structurally impossible** |
| 🧪 | No test generation — you test manually after | Auto-generated tests: UI, API, DB, behavior, security, load |
| 🔄 | Specs drift — no enforcement mechanism | Lock file + SHA-256 hashes detect any divergence |
| 🗑️ | Rewrite = start the whole spec process over | `rm -rf src/` — regenerate from verifications in minutes |
| 🔁 | Linear: specify → plan → tasks → implement | **Autonomous loop:** generate → implement → verify → repeat |
| 🤖 | Human workflow adapted for AI | Process **designed from scratch** for AI agents |

---

## 🎬 Install — One Command, Fully Automatic

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
```

That's it. The installer **auto-detects** every AI coding agent on your machine and **installs native integrations** for each one — plugin, skills, extension, hooks, guards. No manual configuration. No `init` commands. Just install and go.

### What gets installed automatically

| Platform | What the installer does |
|---|---|
| ![Claude Code](https://img.shields.io/badge/Claude_Code-da7756?style=flat-square&logo=claude&logoColor=white) | Installs the ShipFlow **plugin** + anti-cheat hooks |
| ![Codex CLI](https://img.shields.io/badge/Codex_CLI-000000?style=flat-square&logoColor=white) | Installs **skills** + exec policy rules + global instructions |
| ![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-8E75B2?style=flat-square&logo=googlegemini&logoColor=white) | Installs **extension** + BeforeTool guard hooks |
| ![Kiro CLI](https://img.shields.io/badge/Kiro_CLI-a855f7?style=flat-square&logoColor=white) | Installs **skills** + steering context |

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/uninstall.sh | bash
```

Cleanly removes all integrations — plugin, skills, extension, hooks, symlinks, and global package.

---

## 🚀 Agent Flow

Open any project in your AI coding agent and start with a collaborative verification draft, then run the standard implementation loop:

| | Draft the verification pack together | Run the standard loop |
|---|---|---|
| ![Claude Code](https://img.shields.io/badge/Claude_Code-da7756?style=flat-square&logo=claude&logoColor=white) | `/shipflow-verifications a todo app` | `/shipflow-implement` |
| ![Codex CLI](https://img.shields.io/badge/Codex_CLI-000000?style=flat-square&logoColor=white) | `$shipflow-verifications a todo app` | `$shipflow-implement` |
| ![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-8E75B2?style=flat-square&logo=googlegemini&logoColor=white) | `/shipflow:verifications a todo app` | `/shipflow:implement` |
| ![Kiro CLI](https://img.shields.io/badge/Kiro_CLI-a855f7?style=flat-square&logoColor=white) | `"draft ShipFlow verifications for a todo app"` | `"run shipflow implement against the reviewed verification pack"` |

**Step 1** — Human + AI draft the verification pack together. Review it, tighten it, add missing coverage, and remove weak checks.

**Step 2** — Run `shipflow implement`. It validates the pack, generates tests, implements, verifies, and retries within the configured budget.

---

## 🔬 How It Works

### Phase 1 — ✏️ Verification

You describe what you want. You and the AI draft verifications — **executable YAML** that defines the observable behaviors your app must have.

```yaml
# vp/ui/add-numbers.yml
id: add-numbers
title: Adding two numbers shows the correct result
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /
  - click: { testid: btn-2 }
  - click: { testid: btn-plus }
  - click: { testid: btn-3 }
  - click: { testid: btn-equals }
assert:
  - text_equals: { testid: display, equals: "5" }
```

> This isn't a specification document. It's a **machine-readable contract** that compiles directly to a Playwright test.

### Phase 2 — 🤖 Implementation

AI-led, pack-controlled. Once the verification pack is reviewed, the AI reads it, generates Playwright tests, writes application code, runs the tests, reads failures, fixes the code, and **repeats until every test passes or the retry budget is exhausted.**

```
Read VP  →  Generate tests  →  Implement  →  Verify  →  ✅ Pass? Done.
                                    ↑                       ↓
                                    └──── 🔁 Fix & retry ──┘
```

### 🔒 The Anti-Cheat System

ShipFlow makes it **structurally impossible** for the AI to game the tests:

| | Mechanism | What it does |
|---|---|---|
| 🛡️ | **Path protection** | Hooks block any write to `vp/`, `.gen/`, `evidence/` |
| 🔐 | **Cryptographic lock** | SHA-256 hashes of every VP file, verified before each run |
| 🚫 | **Stop gate** | AI cannot report "done" until `shipflow verify` exits 0 |

> *The only way the AI can succeed is by writing code that actually works.*

---

## 🌐 Native Integration — Not a Wrapper

ShipFlow doesn't just "support" AI agents. It installs **native extensions** that speak each platform's language:

| Platform | Integration type | Anti-cheat mechanism |
|---|---|---|
| ![Claude Code](https://img.shields.io/badge/Claude_Code-da7756?style=flat-square&logo=claude&logoColor=white) | Plugin (slash commands + agents) | PreToolUse + Stop hooks |
| ![Codex CLI](https://img.shields.io/badge/Codex_CLI-000000?style=flat-square&logoColor=white) | Skills (`$skill` invocation) | Sandbox + exec policy rules |
| ![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-8E75B2?style=flat-square&logo=googlegemini&logoColor=white) | Extension (slash commands + context) | BeforeTool guard hooks |
| ![Kiro CLI](https://img.shields.io/badge/Kiro_CLI-a855f7?style=flat-square&logoColor=white) | Skills (auto-activated) + steering | PreToolUse guard hooks |

Every integration includes the **full verification schema**, **implementation loop instructions**, and **platform-specific anti-cheat enforcement.** The AI knows exactly what to do, and it can't cheat.

---

## 📋 Seven Verification Types + Policy Gates

| | Type | Path | What it tests |
|---|---|---|---|
| 🖥️ | **UI Checks** | `vp/ui/*.yml` | Browser interactions & visual assertions |
| 📖 | **Behavior Checks** | `vp/behavior/*.yml` | Given/When/Then business logic |
| 🌐 | **API Checks** | `vp/api/*.yml` | HTTP request/response |
| 🗄️ | **Database Checks** | `vp/db/*.yml` | Database state (SQLite, PostgreSQL) |
| ⚡ | **Performance Checks** | `vp/nfr/*.yml` | Performance under load (k6) |
| 🔐 | **Security Checks** | `vp/security/*.yml` | Auth, authz, headers, exposure |
| 🏗️ | **Technical Checks** | `vp/technical/*.yml` | Frameworks, architecture, CI, infra, tooling |
| 📜 | **Policy Gates** | `vp/policy/*.rego` | Organizational rules via OPA |

Plus 🧩 **fixtures** (`vp/ui/_fixtures/*.yml`) for reusable setup flows.

---

## 📁 Project Structure

```
your-app/
├── 📂 vp/                        # ✏️ Verifications (you review these)
│   ├── ui/*.yml
│   ├── behavior/*.yml
│   ├── api/*.yml
│   ├── db/*.yml
│   ├── nfr/*.yml
│   ├── security/*.yml
│   ├── technical/*.yml
│   ├── policy/*.rego
│   └── ui/_fixtures/*.yml
├── 📂 .gen/                      # 🤖 Generated tests — all types (don't touch)
│   ├── playwright/*.test.ts
│   ├── k6/*.js
│   └── manifest.json
├── 📂 evidence/                  # 📊 Results (don't touch)
│   ├── run.json
│   ├── implement.json
│   ├── implement-history.json
│   ├── policy.json
│   ├── ui.json / api.json / security.json ...
│   └── load.json
├── 📂 src/                       # 💻 App code (AI writes this)
└── ⚙️ shipflow.json               # Config
```

## 🛠️ CLI

```bash
shipflow init [--claude|--codex|--gemini|--kiro|--all]  # Set up ShipFlow in a project
shipflow draft [--write] [--ai]                         # Standard flow: co-draft the verification pack
shipflow implement                                      # Standard flow: validate, generate, implement, verify

# Advanced / debug
shipflow map                                            # Review repo surfaces and coverage gaps
shipflow doctor                                         # Check local tools, runners, and adapters
shipflow lint                                           # Lint verification quality
shipflow gen                                            # Generate runnable tests from the pack
shipflow verify                                         # Run generated tests and write evidence
shipflow status                                         # Show pack, generated tests, and evidence
shipflow implement-once                                 # Single implementation pass, no retry loop
```

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
    "provider": "local"
  },
  "impl": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "maxTokens": 16384,
    "historyLimit": 50,
    "srcDir": "src",
    "context": "Node.js HTTP server, no frameworks"
  }
}
```

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

<div align="center">

### 📋 Requirements

**Node.js 18+** · ![Claude Code](https://img.shields.io/badge/Claude_Code-da7756?style=flat-square&logo=claude&logoColor=white) or ![Codex CLI](https://img.shields.io/badge/Codex_CLI-000000?style=flat-square&logoColor=white) or ![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-8E75B2?style=flat-square&logo=googlegemini&logoColor=white) or ![Kiro CLI](https://img.shields.io/badge/Kiro_CLI-a855f7?style=flat-square&logoColor=white)

<br>

*Built for the age of AI coding agents.*<br>
*Stop writing specs. Start shipping.*

<br>

**MIT License**

</div>
