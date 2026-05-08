---
description: Detect and apply layout migrations from older ShipFlow versions
argument-hint: [--apply | --json]
allowed-tools: Read, Write, Bash
---

# ShipFlow — Migrate

Use this command on a repository that was initialized against an older ShipFlow version. It detects layout drift and either lists pending migrations (default, dry-run) or applies them.

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

```bash
shipflow migrate           # dry run — lists what would change
shipflow migrate --apply   # rename / rewrite files in place
shipflow migrate --json    # machine-readable for scripts
```

## Migrations handled

- **slices.move-to-shipflow** — renames `slice/<id>.yml` (legacy root layout) to `.shipflow/slices/<id>.yml`. Removes the empty `slice/` directory afterward. Aborts if a destination filename already exists.
- **gitignore.precise-runtime** — replaces a blanket `.shipflow/` ignore line with the precise runtime-only list (`.shipflow/runtime/`, `.shipflow/draft-session.json`, `.shipflow/implement-thread.json`, `.shipflow/scaffold-state.json`) so the durable substrate (decisions, grill, slices, approvals, reviews, governance) is committed by default.

## Rules

- **Always run `shipflow migrate` (no `--apply`) first** to see the diff. The default is dry-run on purpose; nothing on disk changes until you pass `--apply`.
- Migrations are idempotent: a second run after `--apply` is a no-op.
- After applying, run `shipflow status` and `shipflow trace` to confirm everything still loads cleanly. Commit the migration as one focused diff so reviewers can audit the move.
