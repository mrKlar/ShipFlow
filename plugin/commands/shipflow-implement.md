---
description: Run the standard ShipFlow implementation loop once the draft is ready
argument-hint: [optional focus area]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# ShipFlow — Implementation Loop

Use this command when the draft session is ready and the user wants working code.

## Context

$ARGUMENTS

## Setup

Find the ShipFlow installation:

```bash
SHIPFLOW_DIR="$(find ~/.claude/plugins/cache/shipflow -name 'shipflow.js' -path '*/bin/*' 2>/dev/null | head -1 | xargs dirname | xargs dirname)"
echo "ShipFlow: $SHIPFLOW_DIR"
```

Use `node $SHIPFLOW_DIR/bin/shipflow.js` for all ShipFlow commands.

If the project has no `shipflow.json`, initialize it first:

```bash
node "$SHIPFLOW_DIR/bin/shipflow.js" init
```

## Standard Path

Start with the normal low-friction command:

```bash
node "$SHIPFLOW_DIR/bin/shipflow.js" status --json
node "$SHIPFLOW_DIR/bin/shipflow.js" implement
```

Only continue to implementation when `shipflow status --json` shows either no `draft_session`, or `draft_session.ready_for_implement === true`.

If `draft_session.ready_for_implement !== true`, stop and send the user back to `/shipflow-verifications`. Typical blocking reasons are:
- pending draft items
- accepted proposals not yet written into `vp/**`
- the verification pack changed after the last saved draft session

That command already runs:
- doctor
- lint
- gen
- provider implementation
- verify
- retry until green or retry budget exhausted

## Debug Only If Needed

If the loop fails, inspect:
- `evidence/implement.json`
- `evidence/run.json`
- generated tests under `.gen/`
- the current code under the configured `srcDir` plus any repo-level technical targets allowed by the pack

Drop to granular commands only for debugging:

```bash
node "$SHIPFLOW_DIR/bin/shipflow.js" doctor
node "$SHIPFLOW_DIR/bin/shipflow.js" lint
node "$SHIPFLOW_DIR/bin/shipflow.js" gen
node "$SHIPFLOW_DIR/bin/shipflow.js" verify
node "$SHIPFLOW_DIR/bin/shipflow.js" status
```

## Rules

- Treat the verification pack as ground truth
- Match generated expectations exactly: UI locators, routes, HTTP status/headers/body, database state, security behavior, technical constraints, and performance budgets
- Never edit protected paths: `vp/`, `.gen/`, `evidence/`, `.shipflow/`, `shipflow.json`
- If the verification pack itself is wrong or ambiguous, stop and send the user back to `/shipflow-verifications`
