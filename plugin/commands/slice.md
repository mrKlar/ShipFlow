---
description: Manage vertical slices linking intent → decisions → vp → evidence
argument-hint: list | show <id> | new --id=... --goal="..." | link/unlink <id> --vp=... --decision=... | set-status <id> --status=...
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# ShipFlow — Slices

A slice is a vertical tracer-bullet that ties one piece of user value to its substrate: the grill session(s) that produced shared understanding, the decisions that codified it, the verification files that enforce it, and the evidence that proves it.

Without slices, the verification pack is a flat list. The agent may try to satisfy it in one giant pass and produce code that drifts from the original outcome. With slices, work moves through the pack in small, end-to-end increments — easier to grill, easier to approve, easier to verify.

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

### Create a slice

```bash
shipflow slice new \
  --id=<kebab-id> \
  --goal="One-sentence outcome that proves the slice succeeded." \
  --intent="Optional shorter name for status displays." \
  --status=proposed|planned|in-progress|implemented|verified|shipped|abandoned \
  --vp=vp/<area>/<file>.yml \
  --decision=<decision-id> \
  --grill=<grill-session-id> \
  --reviewer="<role or name>"
```

You can pass `--vp`, `--decision`, `--grill` multiple times or as comma-separated lists. `link` validates that decisions and grill ids exist; missing references fail loudly.

### Inspect

```bash
shipflow slice list
shipflow slice show <id>
```

`show` prints presence (✓/✗) for each `vp` and `evidence` path so the user can see what's still missing in the slice.

### Bind / unbind

```bash
shipflow slice link <id> --vp=vp/security/session.yml --decision=auth-session-expiry
shipflow slice unlink <id> --vp=vp/old/path.yml
shipflow slice set-status <id> --status=verified
```

## Rules

- Every slice must have a one-sentence `goal` describing the outcome that proves it succeeded — not the technical task.
- Every non-trivial slice should reference at least one decision and at least one grill session, so the audit trail can walk from outcome → vp → decisions → grill.
- When a verification finishes passing, link the resulting evidence path to the slice with `--evidence=evidence/<area>/<file>.json`.
- Keep slices small. If a slice spans more than a handful of vp files, split it.
- Mark a slice `abandoned` (do not delete) if the team decides not to pursue it. Slices are part of the durable history.
