# Adapter: Claude Code (ShipFlow v1)

ShipFlow uses Claude Code as the native implementer. No external launcher — Claude IS the loop.

## Models

| Phase | Model | Role |
|---|---|---|
| Spec | `claude-opus-4-6` | Human + AI collaborate to define VP specs |
| Impl | `claude-sonnet-4-6` | AI autonomously writes code that passes VP tests |

Configure in `shipflow.json`:
```json
{
  "models": {
    "spec": "claude-opus-4-6",
    "impl": "claude-sonnet-4-6"
  }
}
```

## Setup

### 1. Copy the CLAUDE.md template

Copy `templates/CLAUDE.md` to your app repo root. Adapt the project context section.

This teaches Claude the two-phase workflow and the implementation loop.

### 2. Install hooks

Copy `templates/claude-hooks.json` to `.claude/hooks.json` in your app repo. Adjust paths to match your ShipFlow installation.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "command": "node tools/shipflow/hooks/guard-paths.js"
      }
    ],
    "Stop": [
      {
        "command": "node tools/shipflow/bin/shipflow.js gen && node tools/shipflow/bin/shipflow.js verify"
      }
    ]
  }
}
```

**PreToolUse** hook: blocks any Edit/Write to `vp/`, `.gen/`, `evidence/` during implementation. The guard script (`hooks/guard-paths.js`) reads the tool input, checks the file path, and exits non-zero to block.

**Stop** hook: runs `gen + verify` when Claude tries to finish. If verify fails, Claude is told to continue — creating the retry loop naturally. Claude reads the test failure output, fixes the code, and tries to stop again. The loop continues until all tests pass.

## How the loop works

```
Claude reads CLAUDE.md
  ↓
Phase 1 (Opus): human + Claude define vp/ specs
  ↓
Phase 2 (Sonnet): Claude implements autonomously
  ↓
  ┌─────────────────────────────────────────┐
  │ 1. Read vp/ specs                       │
  │ 2. Run shipflow gen                     │
  │ 3. Read .gen/playwright/*.spec.ts       │
  │ 4. Write code under src/               │
  │ 5. Run shipflow verify                  │
  │ 6. Fail? → read errors → fix → goto 5  │
  │ 7. Pass? → Claude stops                 │
  └─────────────────────────────────────────┘
  Stop hook enforces step 5-7 automatically
```

## Anti-cheat guarantees

- **PreToolUse hook**: physically prevents Claude from modifying VP, generated tests, or evidence
- **Stop hook**: physically prevents Claude from finishing without green tests
- **VP lock** (`vp.lock.json`): detects any VP tampering between gen and verify
- **CLAUDE.md instructions**: Claude understands WHY these constraints exist

## Files provided by ShipFlow

| File | Purpose |
|---|---|
| `templates/CLAUDE.md` | Workflow instructions for Claude (copy to app repo) |
| `templates/claude-hooks.json` | Hooks config (copy to `.claude/hooks.json`) |
| `hooks/guard-paths.js` | PreToolUse hook script (blocks protected paths) |
