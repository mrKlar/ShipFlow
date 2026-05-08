---
description: Three-Amigos grilling — surface ambiguities and assumptions before a verification pack is written
argument-hint: [<intent>] | list | show <id> | promote <session-id> --decision=<id>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# ShipFlow — Grill (Three-Amigos sensemaking)

Use this command BEFORE drafting a verification pack. The grill phase is the human/AI loop that converts a vague intent into validated shared understanding. Skipping it produces an executable verification pack that may still ship the wrong outcome.

A grill session captures:
- **questions** the team must answer before drafting,
- **findings** (ambiguities, contradictions, edge cases, assumptions, missing negative cases, non-goals, risks),
- **proposed decisions** ready to be promoted into the decision log.

A grill session is NOT a verification pack. It is the sensemaking that should precede one.

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

### 1. Start a session

Recommended: pass `--ai` to use the configured provider. Without `--ai`, the CLI emits a starter template the user can fill in.

```bash
shipflow grill --ai --role=general --intent="<short statement of what the team wants to build>"
```

Roles available: `general` (default), `product`, `architecture`, `qa`, `security`, `risk`. Run multiple sessions with different roles to triangulate.

### Fan out across all five specialist lenses in one command

```bash
shipflow grill --multi --intent="..."
shipflow grill --multi --ai --intent="..."
```

`--multi` is the deliberate Three-Amigos breakdown: it creates one session per specialist role (product, architecture, qa, security, risk) so each lens grills the same intent without bleeding into another's territory. `general` is excluded — `--multi` IS the general view, distributed.

Combine `--multi` with `--role` is rejected (incoherent). Each fan-out session is top-level; use plain `shipflow grill --parent=<id>` for follow-up sessions.

### 2. Review the transcript

The CLI writes a markdown transcript and a JSON record under `.shipflow/grill/<id>.{md,json}`. Open the markdown, paste it back to the user, and:
- For each `Question`, capture the user's answer in the markdown file (replace `_pending_`).
- For each `Finding`, decide the resolution and note it.
- For each `Proposed decision`, decide whether to promote it to the durable decision log.

### 3. Promote proposals to decisions

```bash
shipflow grill promote <session-id> --decision=<proposed-decision-id>
```

This creates a real `.shipflow/decisions/*.yml` entry with `source: grill` and `source_ref: <session-id>`, so the verification pack can later cite *why* the decision was made.

### 4. List / inspect

```bash
shipflow grill list
shipflow grill show <session-id>
```

## Rules

- Do NOT skip grill for "simple" features. The fastest way to ship a wrong outcome is to draft a pack against an unexamined intent.
- Do NOT propose YAML during grill. The deliverable is **questions, findings, and decisions**, not verifications.
- If the user is unsure about scope/outcome/non-goals, run multiple sessions with different `--role` lenses, then merge the resulting decisions.
- When a finding is resolved, edit the session markdown and copy the resolution into the relevant decision's `rationale` or `notes` field. The session is the audit trail; the decisions are the durable substrate.
- The next phase is `/shipflow:draft`, which should reference `--source-ref=<grill-session-id>` when proposing verifications based on grill outcomes.
