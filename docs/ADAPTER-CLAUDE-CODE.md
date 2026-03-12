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
The installer also places native ShipFlow subagents under `~/.claude/agents`.

For projects with visual UI contracts, baseline approval stays explicit and outside the slash-command flow:

```bash
shipflow approve-visual
```

That keeps visual truth reviewed and locked, instead of letting the implementation loop silently bless a changed UI.

## Native Subagents

Claude Code uses native subagents through the `Task` tool during implementation.

- `shipflow-strategy-lead` handles orchestration and strategy changes
- `shipflow-architecture-specialist`
- `shipflow-ui-specialist`
- `shipflow-api-specialist`
- `shipflow-database-specialist`
- `shipflow-security-specialist`
- `shipflow-technical-specialist`

ShipFlow keeps each Task delegation small: one verification slice, one evidence target, one concrete problem to solve.

## How the Loop Works

```
/shipflow:draft → Finalize the verification pack
                            ↓
/shipflow:implement     → AI runs the standard implementation loop
                            ↓
                    ┌────────────────────────────────────┐
                    │ 1. doctor / lint / gen            │
                    │ 2. strategy lead reads evidence   │
                    │ 3. specialist subagents work      │
                    │ 4. verify                         │
                    │ 5. update thread + history        │
                    │ 6. retry until green or budget    │
                    └────────────────────────────────────┘
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

The global installer also adds the ShipFlow subagents to `~/.claude/agents`, which is where the implementation loop expects them.
