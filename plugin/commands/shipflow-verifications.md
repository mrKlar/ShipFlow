---
description: Collaboratively draft or refine a ShipFlow verification pack
argument-hint: [what to build or verify]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# ShipFlow — Verification Collaboration

Use this command when the user wants to define, review, add, remove, or tighten ShipFlow verifications.

This phase is human + AI collaboration, not an autonomous one-shot.

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

## Workflow

### 1. Build context before writing

- Read the user request and the current repo context
- Review existing `vp/` files when they exist
- Read relevant app files when they clarify behavior or architecture
- Run:

```bash
node "$SHIPFLOW_DIR/bin/shipflow.js" map --json "$ARGUMENTS"
node "$SHIPFLOW_DIR/bin/shipflow.js" draft --json "$ARGUMENTS"
```

If the user is continuing an existing review session, you may omit `$ARGUMENTS` and let ShipFlow reuse the saved draft request.
If the user wants to restart the review from scratch, use `node "$SHIPFLOW_DIR/bin/shipflow.js" draft --clear-session`.

### 2. Before writing, surface what the system understood

Give the user a short review:
- what the repo map suggests is already present
- what coverage gaps look important
- what remains ambiguous and needs a human decision

### 3. Review proposals with the user before writing

Treat `shipflow draft` as a review workflow:
- review the candidate proposals with the user
- accept or reject them explicitly
- only then write accepted proposals into `vp/`

Use:

```bash
node "$SHIPFLOW_DIR/bin/shipflow.js" draft --accept=vp/path.yml
node "$SHIPFLOW_DIR/bin/shipflow.js" draft --reject=vp/path.yml
node "$SHIPFLOW_DIR/bin/shipflow.js" draft --accept=vp/path.yml --write
```

Use `--update-existing` only with explicit user approval when replacing an existing verification file:

```bash
node "$SHIPFLOW_DIR/bin/shipflow.js" draft --accept=vp/path.yml --update-existing --write
```

For precise refinements that do not fit a proposal cleanly, edit focused checks under `vp/` manually.

When proposal files would help, prefer:

```bash
node "$SHIPFLOW_DIR/bin/shipflow.js" draft --json "$ARGUMENTS"
```

Use the right verification type:
- UI
- behavior
- API
- database
- performance
- security
- technical

Quality bar:
- one observable behavior per file
- stable selectors and concrete assertions
- explicit auth, error, and edge-case checks when relevant
- clean names and paths
- `warn` only for genuinely non-blocking checks

Do not optimize for check count. Optimize for precision and coverage quality.

### 4. Validate every pass

```bash
node "$SHIPFLOW_DIR/bin/shipflow.js" lint
node "$SHIPFLOW_DIR/bin/shipflow.js" gen
```

### 5. Summarize clearly

Tell the user:
- what changed
- what is still ambiguous
- what is intentionally not covered yet

### 6. When the pack is reviewed

Move to the standard implementation loop with:

```text
/shipflow-implement
```

## Rules

- Do not present the first draft as complete by default
- Do not hide ambiguity; surface it
- Do not write proposal files before the user has reviewed them unless the user explicitly asks for automatic materialization
- Do not replace an existing `vp/` file unless the user explicitly approved that update
- Do not present the pack as ready if `lint` or `gen` fails
- If the user wants code implementation, switch to `/shipflow-implement`
