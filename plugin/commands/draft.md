---
description: Draft or refine a ShipFlow verification pack
argument-hint: [what to build or verify]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# ShipFlow — Verification Collaboration

Use this command when the user wants to define, add, remove, tighten, or finalize ShipFlow verifications.

This phase finalizes the verification pack before implementation. It can be collaborative, or AI-led when the user explicitly wants automatic materialization.

## Context

$ARGUMENTS

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, try `~/.local/bin/shipflow`.

If the project has no `shipflow.json`, initialize it first:

```bash
shipflow init
```

## Workflow

### 1. Build context before writing

- Read the user request and the current repo context
- Review existing `vp/` files when they exist
- Read relevant app files when they clarify behavior or architecture
- On an empty or low-signal greenfield repo, start with:

```bash
shipflow draft --json "$ARGUMENTS"
```

- Use `shipflow map --json "$ARGUMENTS"` only when the existing repo shape matters, especially in brownfield work.
- Run:

```bash
shipflow draft --json "$ARGUMENTS"
```

If the user is continuing an existing draft session, you may omit `$ARGUMENTS` and let ShipFlow reuse the saved draft request.
If the user wants to restart the draft from scratch, use `shipflow draft --clear-session`.

### 2. Before writing, surface what the system understood

Give the user a short summary:
- what the repo map suggests is already present
- what coverage gaps look important
- what remains ambiguous and needs an explicit decision

Conversation style:
- on an empty or low-signal greenfield repo, do not dump all seven verification types immediately
- ask only the single highest-leverage next question from `shipflow draft --json` unless the user explicitly asks for a full review
- after each user answer, rerun `shipflow draft --json` with the refined request or reuse the saved draft session
- ask one focused question at a time, then narrow into the relevant verification types
- use the per-type discussion prompts as your checklist, not as a rigid script
- once the shape is clear, cover UI, behavior, API, database, performance, security, and technical progressively
- for each relevant type, ask what should be verified and surface at most one or two best-practice prompts before you write anything
- do not present a long list of open questions spanning several verification types in one turn

If `shipflow draft --json` returned `clarifications`, ask concise clarification questions unless the user explicitly delegated the choice to you.
If the user did explicitly allow autonomous choices, say which defaults you are choosing, rerun `shipflow draft --json` with those choices folded into the scope, then materialize the selected proposals.

### 3. Finalize proposals before writing

Treat `shipflow draft` as the pack-definition workflow:
- examine the candidate proposals with the user when collaboration is desired
- accept or reject them explicitly
- or, if the user asked for an autonomous draft, choose reasonable defaults and write the selected proposals into `vp/`
- do not abandon this flow just because the proposals came from local drafting rather than AI refinement; ShipFlow proposals are first-class
- do not pivot to “manual pack authoring” or example-hunting as the primary path when `shipflow draft` already returned valid proposals
- do not inspect ShipFlow examples, templates, or source files to reverse-engineer the YAML format during a normal draft flow; use `shipflow draft`, `shipflow lint`, and `shipflow gen`

Use:

```bash
shipflow draft --accept=vp/path.yml
shipflow draft --reject=vp/path.yml
shipflow draft --accept=vp/path.yml --write
```

Use `--update-existing` only with explicit user approval when replacing an existing verification file:

```bash
shipflow draft --accept=vp/path.yml --update-existing --write
```

For precise refinements that do not fit a proposal cleanly, edit focused checks under `vp/` manually.

When proposal files would help, prefer:

```bash
shipflow draft --json "$ARGUMENTS"
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
- for `technical`, choose `runner.kind` / `runner.framework` deliberately and prefer backend-native rules over smoke commands like `--help` / `--version`
- `warn` only for genuinely non-blocking checks

Do not optimize for check count. Optimize for precision and coverage quality.

### 4. Validate every pass

```bash
shipflow lint
shipflow gen
```

### 5. Summarize clearly

Tell the user:
- what changed
- what is still ambiguous
- what is intentionally not covered yet

### 6. When the pack is finalized

Move to the standard implementation loop with:

```text
/shipflow:implement
```

## Rules

- Do not present the first draft as complete by default
- Do not hide ambiguity; surface it
- Do not write proposal files before the draft is finalized unless the user explicitly asks for automatic materialization
- Do not replace an existing `vp/` file unless the user explicitly approved that update
- Do not present the pack as ready if `lint` or `gen` fails
- If the user wants code implementation, switch to `/shipflow:implement`
