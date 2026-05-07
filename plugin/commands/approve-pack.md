---
description: Sign the current verification pack so implement can run against it
argument-hint: [(default approves) | status | list | show <id> | revoke <id>]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# ShipFlow — Approve Pack

Use this command when a human reviewer has read and accepted the current verification pack as the executable capture of validated understanding. Approval binds a sha256 of the pack to the reviewer; if the pack changes, the approval no longer applies and must be re-run.

When the org enables the gating policy (`shipflow.json` `impl.requirePackApproval: true`, or env `SHIPFLOW_REQUIRE_APPROVAL=1`), `shipflow implement` refuses to run until an active approval matches the current pack hash. This is the line of defense that prevents the agent from implementing an AI-generated pack that no human ever reviewed.

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

### Approve the current pack

```bash
shipflow approve-pack \
  --approver="<name or role>" \
  --role=architect|product|qa|security|engineering|other \
  --scope="<optional, e.g. slice id, area>" \
  --notes="<optional>" \
  --decision-ref=<decision-id> \
  --grill-ref=<grill-session-id>
```

If `--approver` is omitted the CLI uses `SHIPFLOW_APPROVER`, then `GIT_AUTHOR_NAME`, then `USER`.

### Status of the current pack

```bash
shipflow approve-pack status
```

Reports whether the current pack hash matches an active approval.

### List / show / revoke

```bash
shipflow approve-pack list
shipflow approve-pack show <id>
shipflow approve-pack revoke <id> --reason="..."
```

## Rules

- **Do not approve a pack you did not actually review.** Approval is a signed claim. Treat it like a commit signoff.
- Cite the substrate: include `--decision-ref=` for the durable decisions the pack enforces, and `--grill-ref=` for the grill sessions that produced the shared understanding. Future audits should be able to walk from approval → decisions → grill transcript → original intent.
- If the user changes a `vp/**` file after approval, the approval is automatically invalidated (its `pack_sha256` no longer matches the current pack). Re-approve once changes are reviewed.
- The gate is opt-in via config or env. If the user enables it, do NOT bypass with `--no-verify`-style flags. Either approve, or stop and ask the user.
