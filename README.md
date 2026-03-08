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
