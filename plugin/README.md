# ShipFlow Plugin for Claude Code

Verification-first development workflow. The AI drafts executable verifications, generates tests, implements the app, and loops until all tests pass.

## Install

```bash
cd /path/to/ShipFlow
./install.sh
```

## Commands

| Command | Phase | Description |
|---|---|---|
| `/shipflow-verifications` | Verification | AI drafts verifications, you refine |
| `/shipflow-impl` | Implementation | AI builds the app until all tests pass |

## Agents

| Agent | Model | Role |
|---|---|---|
| `vp-analyst` | opus | Analyzes requirements and drafts verifications |
| `impl-verifier` | sonnet | Implements code and runs verify loop |

## How it works

```
/shipflow-verifications  →  AI drafts vp/ checks, human refines (Opus)
/shipflow-impl           →  AI implements src/, loops on verify (Sonnet)
```
