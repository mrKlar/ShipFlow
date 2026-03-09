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

Use the installed `shipflow` CLI directly. If it is not on `PATH`, try `~/.local/bin/shipflow`.

If the project has no `shipflow.json`, initialize it first:

```bash
shipflow init
```

## Standard Path

Start with the normal low-friction command:

```bash
shipflow status --json
shipflow implement
```

Only continue to implementation when `shipflow status --json` shows `implementation_gate.ready === true`.
Inspect the JSON output directly. Do not wrap `shipflow status --json` in `python`, `jq`, or shell pipelines unless ShipFlow itself returned malformed output.
Run `shipflow implement` directly. Do not unset CLI session variables manually; ShipFlow handles nested provider subprocesses itself.

If `implementation_gate.ready !== true`, stop and send the user back to `/shipflow:draft`. Typical blocking reasons are:
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

If the loop takes time, inspect `evidence/implement.json` or `shipflow status --json` for the current stage before assuming it is hung.

## Debug Only If Needed

If the loop fails, inspect:
- `evidence/implement.json`
- `evidence/run.json`
- generated tests under `.gen/`
- the current code under the configured `srcDir` plus any repo-level technical targets allowed by the pack

Drop to granular commands only for debugging:

```bash
shipflow doctor
shipflow lint
shipflow gen
shipflow verify
shipflow status
```

## Rules

- Treat the verification pack as ground truth
- Match generated expectations exactly: UI locators, routes, HTTP status/headers/body, database state, security behavior, technical constraints, and performance budgets
- Never edit protected paths: `vp/`, `.gen/`, `evidence/`, `.shipflow/`, `shipflow.json`
- If the verification pack itself is wrong or ambiguous, stop and send the user back to `/shipflow:draft`
