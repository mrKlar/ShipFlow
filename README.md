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

> 🚀 **ShipFlow starts from zero.** No specs. No handoffs. You describe what the app must do. The AI writes executable verifications, generates real tests, builds the entire application, and loops until every test passes. The process isn't *assisted by* AI — it's **designed for** AI.

```
 You describe           AI drafts              AI generates           AI builds & loops
"a calculator"  ──▶  vp/**/*.yml  ──▶  .gen/playwright/*.ts  ──▶  src/**  ──▶  ✅ all tests pass
```

🔒 The AI **cannot cheat** — cryptographic locks and runtime hooks make it impossible to modify the verifications or tests during implementation. The only way out is **working code**.

---

<div align="center">

## 🗑️ Delete Everything. Regenerate Anytime.

### Your code is **disposable**. Your verifications are **permanent**.

</div>

> Don't like the implementation? `rm -rf src/ && shipflow impl` — the AI rebuilds the entire app from scratch, guaranteed to pass every verification. **Legacy code doesn't exist** when you can regenerate on demand. No more "don't touch that, nobody knows how it works." No more drift. No more tech debt that compounds for years. Your verifications are the single source of truth — the code is just a **replaceable artifact**.

---

## ⚡ Why ShipFlow

| | Spec-driven *(old)* | ShipFlow *(new)* |
|---|---|---|
| 📝 | Write specs, then code separately | Verifications ARE the spec AND the test |
| 🔄 | Specs drift from implementation | Lock file detects any divergence |
| 🧪 | Manual testing against specs | Auto-generated tests: UI, API, DB, behavior, load |
| 🤞 | Trust the developer followed the spec | Hooks block the AI from cheating |
| ⏱️ | Weeks to go from spec to working app | **Minutes.** The AI loops until green. |
| 🗑️ | Rewrite = months of work lost | **Delete & regenerate.** Code is disposable, verifications are forever. |

---

## 🎬 Install — One Command, Fully Automatic

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
```

That's it. The installer **auto-detects** every AI coding agent on your machine and **installs native integrations** for each one — plugin, skills, extension, hooks, guards. No manual configuration. No `init` commands. Just install and go.

### What gets installed automatically

| Platform | What the installer does |
|---|---|
| 🟣 **Claude Code** | Installs the ShipFlow **plugin** + anti-cheat hooks |
| 🟢 **Codex CLI** | Installs **skills** + exec policy rules + global instructions |
| 🔵 **Gemini CLI** | Installs **extension** + BeforeTool guard hooks |
| 🟠 **Kiro CLI** | Installs **skills** + steering context |

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/uninstall.sh | bash
```

Cleanly removes all integrations — plugin, skills, extension, hooks, symlinks, and global package.

---

## 🚀 Usage

Open any project in your AI coding agent and use the **native commands:**

| | Describe your app | Build it |
|---|---|---|
| 🟣 Claude Code | `/shipflow-verifications a todo app` | `/shipflow-impl` |
| 🟢 Codex CLI | `$shipflow-verifications a todo app` | `$shipflow-impl` |
| 🔵 Gemini CLI | `/shipflow:verifications a todo app` | `/shipflow:impl` |
| 🟠 Kiro CLI | `shipflow-verifications a todo app` | `shipflow-impl` |

**Step 1** — The AI drafts **50+ verifications in seconds**. Review them, tweak if needed.

**Step 2** — Run impl. ☕ Walk away. Come back to a **working app** with every behavior verified.

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

## 🌐 Native Integration — Not a Wrapper

ShipFlow doesn't just "support" AI agents. It installs **native extensions** that speak each platform's language:

| Platform | Integration type | Anti-cheat mechanism |
|---|---|---|
| 🟣 **Claude Code** | Plugin (slash commands + agents) | PreToolUse + Stop hooks |
| 🟢 **Codex CLI** | Skills (`$skill` invocation) | Sandbox + exec policy rules |
| 🔵 **Gemini CLI** | Extension (slash commands + context) | BeforeTool guard hooks |
| 🟠 **Kiro CLI** | Skills (auto-activated) + steering | PreToolUse guard hooks |

Every integration includes the **full verification schema**, **implementation loop instructions**, and **platform-specific anti-cheat enforcement.** The AI knows exactly what to do, and it can't cheat.

---

## 📋 Six Verification Types + Policy Gates

| | Type | Path | What it tests |
|---|---|---|---|
| 🖥️ | **UI Checks** | `vp/ui/*.yml` | Browser interactions & visual assertions |
| 📖 | **Behavior Checks** | `vp/behavior/*.yml` | Given/When/Then business logic |
| 🌐 | **API Checks** | `vp/api/*.yml` | HTTP request/response |
| 🗄️ | **Database Checks** | `vp/db/*.yml` | Database state (SQLite, PostgreSQL) |
| ⚡ | **Performance Checks** | `vp/nfr/*.yml` | Performance under load (k6) |
| 🔐 | **Security Checks** | `vp/security/*.yml` | Auth, authz, headers, exposure |
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
│   ├── policy/*.rego
│   └── ui/_fixtures/*.yml
├── 📂 .gen/                      # 🤖 Generated tests (don't touch)
│   ├── playwright/*.test.ts
│   └── k6/*.js
├── 📂 evidence/                  # 📊 Results (don't touch)
│   └── run.json
├── 📂 src/                       # 💻 App code (AI writes this)
└── ⚙️ shipflow.json               # Config
```

## 🛠️ CLI

```bash
shipflow init [--claude|--codex|--gemini]   # 📦 Scaffold project
shipflow map                                 # 🗺️  Analyze repo + coverage gaps before drafting
shipflow lint                                # 🔎  Lint VP quality before generation
shipflow gen                                 # ⚙️  Compile verifications → tests
shipflow verify                              # ✅ Run tests → evidence
shipflow run                                 # 🔁 Full autonomous loop: gen → impl → verify
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

**Node.js 18+** · **Claude Code** or **Codex CLI** or **Gemini CLI** or **Kiro CLI**

<br>

*Built for the age of AI coding agents.*<br>
*Stop writing specs. Start shipping.*

<br>

**MIT License**

</div>
