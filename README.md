# ShipFlow (Framework) v1

ShipFlow is a **verification-first workflow framework** where:
- **ShipFlowPack** is the only human-readable source of truth.
- Implementation code is treated as opaque.
- Verifiers are **generated** from VP (ultra-pure mode) and executed to produce evidence.
- A single gate (CI or wrapper) decides merge based on evidence.

This repository contains **no app-specific content**.

## What ShipFlow provides
- VP format conventions (folders + schemas)
- `shipflow gen` compiler: VP -> generated runnable tests (opaque)
- `shipflow verify` runner: executes generated tests and emits evidence
- Policy hooks (OPA/Rego) integration point
- Adapter guidelines for AI CLIs (Claude Code, Codex CLI, Gemini CLI)

## Install into an app repo (Node)
Option A: git submodule
- add this repo as `tools/shipflow/`
- call `node tools/shipflow/bin/shipflow.js ...`

Option B: copy `bin/` + `lib/` into your org tooling repo.

## Commands
- `shipflow gen`  -> produces `.gen/` + `.gen/vp.lock.json`
- `shipflow verify` -> produces `evidence/`

See `docs/VP-ULTRA-PURE.md` for the v1 spec.
