# Claude Code Adapter

ShipFlow uses Claude Code as the native implementation engine. No external launcher — Claude Code IS the loop.

## Plugin

ShipFlow installs as a Claude Code plugin providing two commands:

| Command | Model | Role |
|---|---|---|
| `/shipflow-verifications` | Opus 4.6 | Human + AI draft verifications |
| `/shipflow-impl` | Sonnet 4.6 | AI implements autonomously |

Install with `./install.sh`. This registers a marketplace and installs the plugin.

## How the Loop Works

```
/shipflow-verifications → AI drafts vp/ checks, human refines
                            ↓
/shipflow-impl          → AI reads VP, generates tests, implements code
                            ↓
                    ┌───────────────────────────┐
                    │ 1. Read vp/**/*.yml       │
                    │ 2. shipflow gen           │
                    │ 3. Read .gen/ tests       │
                    │ 4. Write code under src/  │
                    │ 5. shipflow verify        │
                    │ 6. Fail? Fix → goto 5     │
                    │ 7. Pass? Done             │
                    └───────────────────────────┘
                    Stop hook enforces step 5-7
```

## Hooks

When `./install.sh /path/to/project` is run, it creates `.claude/hooks.json`:

**PreToolUse**: Blocks Write/Edit to `vp/`, `.gen/`, `evidence/` during implementation.

**Stop**: Runs `shipflow gen && shipflow verify` when the AI tries to finish. If verify fails, the AI continues working.

## Anti-Cheat

- **PreToolUse hook** prevents modification of VP, generated tests, and evidence
- **Stop hook** prevents completion without green tests
- **VP lock** (SHA-256) detects tampering between gen and verify
- **CLAUDE.md** teaches the AI the constraints and workflow

## Project Setup

`./install.sh /path/to/project` creates:

| File | Purpose |
|---|---|
| `CLAUDE.md` | Workflow instructions for the AI |
| `.claude/hooks.json` | Anti-cheat hooks |
| `vp/ui/_fixtures/` | Fixture directory scaffold |
