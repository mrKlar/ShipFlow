# ShipFlow - Project Objectives

## Vision

ShipFlow is a **verification-first workflow framework** designed to govern software development — especially when implementation is produced by AI agents (Claude Code, Codex CLI, Gemini CLI, etc.).

The core idea is an **inversion of the classic flow**:

1. **The human writes the spec** — as "Verification Packs" (`vp/`), human-readable YAML/SQL/Rego files that are reviewed. This is the **single source of truth**.
2. **The framework generates the tests** — `shipflow gen` compiles Verification Packs into executable tests (Playwright for UI, k6 for NFR, etc.) in `.gen/`. These tests are **opaque** and must never be manually edited.
3. **The framework runs verification** — `shipflow verify` executes generated tests and produces an `evidence/` directory containing results (`run.json`).
4. **A single gate** (CI or AI agent hooks) blocks merge if evidence is not green.

The key anti-cheat property: **the implementer (human or AI) cannot touch specs, generated tests, or results**. This prevents an AI agent from "cheating" by modifying tests to pass rather than fixing the code.

## Current State (v0.1.0)

The project is at an **early stage but functional for a first vertical**.

### Implemented

- **CLI** (`bin/shipflow.js`) with two commands: `gen` and `verify`
- **UI generator**: reads `vp/ui/*.yml` files, validates them with a Zod schema (`UiCheck`), and generates Playwright specs (`.gen/playwright/*.spec.ts`)
- **Lock system** (`vp.lock.json`): SHA-256 hashing of all VP files to detect any modification between `gen` and `verify`
- **Verification runner**: executes Playwright via `npx`, produces `evidence/run.json` with status, duration, exit code
- **UI DSL schema**: closed vocabulary — `open`, `click` (by role), `wait_for`, with `text_equals` and `text_matches` assertions (by `data-testid`)
- **Documentation**: Verification Pack spec, Claude Code adapter guide (hooks `PreToolUse` / `Stop`)

### Planned but not yet implemented

- **API verification** (`vp/api/` — OpenAPI, JSON Schema) — structure defined in the spec, no generator yet
- **Data verification** (`vp/data/*.sql`) — same
- **NFR verification** (`vp/nfr/` -> k6) — mentioned as "v1 stub"
- **OPA/Rego policy gate** (`vp/policy/*.rego`) — integration point exists in `verify.js` (comment), but no execution
- **Concrete adapter hooks** — `ADAPTER-CLAUDE-CODE.md` describes the strategy but no hook script is shipped
- **No tests for the framework itself**, no CI

### Technical Architecture

- Pure Node.js ESM, minimal dependencies (`js-yaml` + `zod`)
- No bundler, no TypeScript (despite generating `.spec.ts`)
- Designed to be embedded in an app repo via git submodule or direct copy
- ~200 lines of code total
