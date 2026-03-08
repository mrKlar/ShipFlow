<div align="center">

# 🚢 ShipFlow

### *Spec-driven development is dead.*<br>Welcome to **verification-first**.

<br>

[![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen)](https://nodejs.org)
[![183 tests](https://img.shields.io/badge/tests-183%20passing-brightgreen)](#)
[![License MIT](https://img.shields.io/badge/license-MIT-blue)](#license)

</div>

---

Traditional spec-driven development was designed for humans writing code. You spend weeks writing specifications, then months building what you described, hoping the result matches. With AI coding agents, **this is backwards.**

> 🚀 **ShipFlow flips the model.** You describe what the app must do. The AI writes executable verifications, generates real tests, builds the entire application, and loops until every test passes. No specs. No handoffs. No gap between intent and implementation.

```
 You describe           AI drafts              AI generates           AI builds & loops
"a calculator"  ──▶  vp/**/*.yml  ──▶  .gen/playwright/*.ts  ──▶  src/**  ──▶  ✅ all tests pass
```

🔒 The AI **cannot cheat** — cryptographic locks and runtime hooks make it impossible to modify the verifications or tests during implementation. The only way out is **working code**.

---

## ⚡ Why ShipFlow

| | Spec-driven *(old)* | ShipFlow *(new)* |
|---|---|---|
| 📝 | Write specs, then code separately | Verifications ARE the spec AND the test |
| 🔄 | Specs drift from implementation | Lock file detects any divergence |
| 🧪 | Manual testing against specs | Auto-generated tests: UI, API, DB, behavior, load |
| 🤞 | Trust the developer followed the spec | Hooks block the AI from cheating |
| ⏱️ | Weeks to go from spec to working app | **Minutes.** The AI loops until green. |

---

## 🎬 30-Second Demo

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
```

> ☝️ Auto-detects Claude Code, Codex CLI, and Gemini CLI on your machine.

Restart Claude Code. Open any project:

```
/shipflow-verifications a kawaii calculator with a fox mascot
```

The AI drafts **50+ verifications in seconds**. Review them. Then:

```
/shipflow-impl
```

☕ Walk away. Come back to a **working app** with every behavior verified.

---

## 🔬 How It Works

### Phase 1 — ✏️ Verification

You describe what you want. The AI drafts verifications — **executable YAML** that defines every behavior your app must have.

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

Fully autonomous. The AI reads the verifications, generates Playwright tests, writes all application code, runs the tests, reads failures, fixes the code, and **repeats until every test passes.**

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

## 🌐 Multi-Agent Support

Works with **every major AI coding agent:**

| Platform | Setup | Anti-cheat |
|---|---|---|
| 🟣 **Claude Code** | Plugin + hooks | PreToolUse + Stop hooks |
| 🟢 **OpenAI Codex CLI** | AGENTS.md + sandbox | OS-level write restrictions |
| 🔵 **Google Gemini CLI** | GEMINI.md + hooks | BeforeTool JSON protocol |

```bash
shipflow init                        # 🟣 Claude Code (default)
shipflow init --codex                # 🟢 Codex CLI
shipflow init --gemini               # 🔵 Gemini CLI
shipflow init --claude --codex       # 🟣+🟢 Multiple
```

---

## 📋 Five Verification Types

| | Type | Path | What it tests |
|---|---|---|---|
| 🖥️ | **UI Checks** | `vp/ui/*.yml` | Browser interactions & visual assertions |
| 📖 | **Behavior Checks** | `vp/behavior/*.yml` | Given/When/Then business logic |
| 🌐 | **API Checks** | `vp/api/*.yml` | HTTP request/response |
| 🗄️ | **DB Checks** | `vp/db/*.yml` | Database state (SQLite, PostgreSQL) |
| ⚡ | **NFR Checks** | `vp/nfr/*.yml` | Performance under load (k6) |

Plus 🧩 **fixtures** (`vp/ui/_fixtures/*.yml`) for reusable setup flows and 📜 **policy gates** (`vp/policy/*.rego`) for organizational rules via OPA.

---

## 📁 Project Structure

```
your-app/
├── 📂 vp/                        # ✏️ Verifications (you review these)
│   ├── ui/*.yml
│   ├── behavior/*.yml
│   ├── api/*.yml
│   ├── db/*.yml
│   └── ui/_fixtures/*.yml
├── 📂 .gen/                      # 🤖 Generated tests (don't touch)
│   └── playwright/*.test.ts
├── 📂 evidence/                  # 📊 Results (don't touch)
│   └── run.json
├── 📂 src/                       # 💻 App code (AI writes this)
└── ⚙️ shipflow.json               # Config
```

## 🛠️ CLI

```bash
shipflow init [--claude|--codex|--gemini]   # 📦 Scaffold project
shipflow gen                                 # ⚙️  Compile verifications → tests
shipflow verify                              # ✅ Run tests → evidence
shipflow status                              # 📊 Show project state
```

## ⚙️ Configuration

```json
{
  "impl": {
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

**Node.js 18+** · **Claude Code** or **Codex CLI** or **Gemini CLI**

<br>

*Built for the age of AI coding agents.*<br>
*Stop writing specs. Start shipping.*

<br>

**MIT License**

</div>
