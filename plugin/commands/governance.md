---
description: Validate the verification pack against the organization's governance policy
argument-hint: init | check (default) | show
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# ShipFlow — Governance

Use this command when the team or org wants to express durable rules about what "approved" means: which roles must sign off, which grill lenses are mandatory, how many decisions must back each verification, whether negative cases are required, and so on. The policy lives in `.shipflow/governance.yml` and is enforced by `shipflow governance check`.

This is the layer that turns ShipFlow into something a 20+ year software company can adopt with audit confidence: the policy is in version control, it is executable, and it produces a pass/fail signal rather than a vibes-based reviewer judgment.

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

### Scaffold a starter policy

```bash
shipflow governance init
```

Writes `.shipflow/governance.yml` with permissive defaults. Edit it to match your org.

### Inspect

```bash
shipflow governance show
shipflow governance show --json
```

### Check the current pack against the policy

```bash
shipflow governance check
shipflow governance check --json
```

Returns exit code 0 on pass, 1 on fail. Suitable for CI.

## Policy fields

```yaml
version: 1
require_pack_approval: false           # mirrors shipflow.json -> impl.requirePackApproval
required_approver_roles: []            # at least one active approval per role
required_grill_roles: []               # at least one grill session per role
min_decisions_per_vp: 0                # minimum decision-impact bindings per vp
require_negative_cases: false          # fail when critique flags happy_path_only / *_no_negative
forbid_orphan_decisions: false         # fail when a decision has no impacts
forbid_open_reviews: false             # fail when any artifact review is in 'open' status
notes: ""                              # human-readable context
```

## Rules

- Treat governance as a contract between the org and the framework. Tighten one field at a time, run `shipflow governance check` in CI, fix findings, then tighten the next field.
- `require_pack_approval` should be paired with `required_approver_roles` so approvals are not just present but balanced (e.g. architect + security).
- `require_negative_cases: true` is a strong signal that the team takes "happy-path-only YAML" seriously. Recommend turning it on as soon as the pack has more than a handful of checks.
- Governance findings are reported with `error` / `warn` levels. Errors fail the check; warnings inform.
