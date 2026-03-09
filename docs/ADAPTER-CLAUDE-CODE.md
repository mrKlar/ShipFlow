# Claude Code Adapter

ShipFlow uses Claude Code as a first-class implementation surface. The normal user flow is verification drafting plus `shipflow implement`.

## Plugin

ShipFlow installs as a Claude Code plugin providing two commands:

| Command | Model | Role |
|---|---|---|
| `/shipflow-draft` | Opus 4.6 | Finalize the verification pack |
| `/shipflow-implement` | Sonnet 4.6 | AI runs the standard implementation loop |
| `/shipflow-impl` | Sonnet 4.6 | Legacy alias |

Install the global plugin with `./install.sh`. Then run `shipflow init --claude` inside each project that should use ShipFlow.

## How the Loop Works

```
/shipflow-draft → Finalize the verification pack
                            ↓
/shipflow-implement     → AI runs the standard implementation loop
                            ↓
                    ┌───────────────────────────┐
                    │ 1. shipflow implement     │
                    │ 2. doctor                 │
                    │ 3. lint                   │
                    │ 4. gen                    │
                    │ 5. write code under src/  │
                    │ 6. verify                 │
                    │ 7. retry until green      │
                    └───────────────────────────┘
                    Stop hook enforces final verify
```

## Hooks

When `shipflow init --claude` is run inside a project, it creates `.claude/hooks.json`:

**PreToolUse**: Blocks Write/Edit to `vp/`, `.gen/`, `evidence/` during implementation.

**Stop**: Runs `shipflow gen && shipflow verify` when the AI tries to finish. If verify fails, the AI continues working.

## Anti-Cheat

- **PreToolUse hook** prevents modification of VP, generated tests, and evidence
- **Stop hook** prevents completion without green tests
- **VP lock** (SHA-256) detects tampering between gen and verify
- **CLAUDE.md** teaches the AI the constraints and workflow

## Project Setup

`shipflow init --claude` creates:

| File | Purpose |
|---|---|
| `CLAUDE.md` | Workflow instructions for the AI |
| `.claude/hooks.json` | Anti-cheat hooks |
| `vp/ui/_fixtures/` | Fixture directory scaffold |
