---
description: Capture structured human feedback against a vp file, slice, decision, or evidence artifact
argument-hint: list | show <id> | new --target=... --target-kind=... --text="..." | resolve <id> | wont-fix <id> | reopen <id>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# ShipFlow — Review Artifact

A verification pack drifts when feedback stays verbal. `review-artifact` is the surface that turns concerns / change requests / questions into durable, citable artifacts tied to a specific target (a vp file, a slice, a decision, a screenshot, or a piece of evidence).

Without this layer, "we agreed to fix that" is a hallway memory. With it, the audit trail walks: target → review → resolution → updated vp → new approval.

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

### Capture feedback

```bash
shipflow review-artifact new \
  --target=<vp/path/file.yml | slice-id | evidence/path | decision-id | grill-session-id> \
  --target-kind=vp|slice|evidence|screenshot|api_sample|decision|grill \
  --kind=concern|change_request|approval|question \
  --text="What is wrong, what would make it right." \
  --reviewer="<name or role>" \
  --slice=<slice-id> \
  --decision-ref=<decision-id> \
  --follow-up="<optional next-step item>"
```

### List / inspect / resolve

```bash
shipflow review-artifact list --status=open
shipflow review-artifact show <id>
shipflow review-artifact resolve <id> --resolved-by="..." --resolution-notes="What changed in the pack."
shipflow review-artifact wont-fix <id> --resolution-notes="Why we are not addressing this."
shipflow review-artifact reopen <id>
```

## Rules

- Every meaningful piece of review feedback should produce a `review-artifact new`. Verbal "we'll fix this" entries decay; the structured log does not.
- When a reviewer says "I am OK with this", capture it as `--kind=approval` so the trail records the assent, not just the absence of objection.
- When resolving, `--resolution-notes` should describe **what changed in the pack**, not "fixed" or "done". Future readers must be able to walk from the review to the diff.
- Open reviews block approval in spirit, even when the gating policy is off. If `shipflow status` shows open reviews on a vp file, push the user to resolve them before `/shipflow:approve-pack`.
