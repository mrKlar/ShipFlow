# Claude Code Adapter

ShipFlow uses Claude Code as a first-class implementation surface. The normal user flow is verification drafting plus `shipflow implement`.

## Plugin

ShipFlow installs as a Claude Code plugin providing the standard flow plus native debug commands:

| Command | Model | Role |
|---|---|---|
| `/shipflow:draft` | Opus 4.6 | Finalize the verification pack |
| `/shipflow:implement` | Sonnet 4.6 | AI runs the standard implementation loop |
| `/shipflow:map` | Sonnet 4.6 | Inspect repo surfaces and coverage gaps |
| `/shipflow:doctor` | Sonnet 4.6 | Check runtime and backend readiness |
| `/shipflow:lint` | Sonnet 4.6 | Lint the verification pack |
| `/shipflow:gen` | Sonnet 4.6 | Generate runnable verification artifacts |
| `/shipflow:verify` | Sonnet 4.6 | Run generated verifications |
| `/shipflow:status` | Sonnet 4.6 | Inspect pack, artifact, and evidence state |

Install the global plugin with `./install.sh`. Then run `shipflow init --claude` inside each project that should use ShipFlow.

## How the Loop Works

```
/shipflow:draft → Finalize the verification pack
                            ↓
/shipflow:implement     → AI runs the standard implementation loop
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

**PreToolUse**:
- blocks Write/Edit to `vp/`, `.gen/`, `evidence/` during implementation
- blocks Bash detours that inspect installed ShipFlow examples/templates/internal schema instead of using `shipflow draft`

**Stop**: Runs `shipflow gen && shipflow verify` when the AI tries to finish. If verify fails, the AI continues working.

## Anti-Cheat

- **PreToolUse hooks** prevent modification of VP, generated tests, and evidence, and keep draft flows on `shipflow draft` instead of reverse-engineering ShipFlow internals
- **Stop hook** prevents completion without green tests
- **Cryptographic lock** (SHA-256) detects tampering between `gen` and `verify` for both `vp/` and `.gen/`
- **CLAUDE.md** teaches the AI the constraints and workflow

## Project Setup

`shipflow init --claude` creates:

| File | Purpose |
|---|---|
| `CLAUDE.md` | Workflow instructions for the AI |
| `.claude/hooks.json` | Anti-cheat hooks |
| `vp/ui/_fixtures/` | Fixture directory scaffold |
