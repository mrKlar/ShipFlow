---
description: Capture validated decisions backing the verification pack
argument-hint: [list | show <id> | new --id=... | link <id> --vp=...]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# ShipFlow — Decision Log

Use this command when the user wants to record, inspect, or link a product / architecture / UX / security / data decision that backs one or more verification files.

A decision answers: **what was decided, why, and which verifications must enforce it.** Without a decision behind a verification, the pack risks becoming AI-generated YAML disconnected from human judgment.

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry the command as `~/.local/bin/shipflow`.

## Workflow

### List decisions

```bash
shipflow decision list --json
```

Summarize:
- count, by status (proposed / accepted / superseded / rejected)
- which decisions have no `impacts` (verifications they bind)
- any schema or duplicate-id issues

### Show one

```bash
shipflow decision show <id>
```

### Record a new decision

```bash
shipflow decision new \
  --id=<kebab-id> \
  --type=product|architecture|ux|security|data|process|other \
  --status=proposed|accepted|superseded|rejected \
  --title="..." \
  --question="..." \
  --decision="..." \
  --rationale="..." \
  --source=grill|review|incident|client-feedback|manual|discovery \
  --source-ref="grill-2026-05-07.md or url" \
  --impacts=vp/security/session-timeout.yml \
  --decided-by="role or name" \
  --notes="optional"
```

You can pass `--impacts` multiple times or use a comma-separated list.

### Link an impact to existing verifications

```bash
shipflow decision link <id> --vp=vp/security/session-timeout.yml
shipflow decision link <id> --vp=vp/api/sessions.yml
shipflow decision unlink <id> --vp=vp/old/path.yml
```

## Rules

- A decision must capture the **question, the decision, and the rationale**. If any of the three is missing, push the user to clarify before recording.
- If the user describes a new constraint without a backing decision, propose `shipflow decision new` first, then add the matching VP file.
- Decisions live in `.shipflow/decisions/*.yml` and are part of the project's verification trust chain. Treat them as durable.
- When a verification is added or modified during `/shipflow:draft` and reflects a non-obvious choice, propose creating or linking a decision so the next reviewer can audit *why* the constraint exists.
