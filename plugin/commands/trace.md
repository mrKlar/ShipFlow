---
description: Render the verification pack traceability matrix
argument-hint: [--json | --markdown]
allowed-tools: Read, Glob, Grep, Bash
---

# ShipFlow — Trace

Use this command when you need to walk the audit trail: which **vp** files are bound to which **decisions**, which **grill sessions** produced those decisions, which **slices** group them, what **generated tests** and **evidence** they produce, whether the current pack hash is **approved**, and whether any **artifact reviews** are open.

`shipflow trace` is the read-only surface that proves the verification pack is the *executable capture of validated understanding*, not isolated YAML.

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

```bash
shipflow trace
shipflow trace --json
shipflow trace --markdown
shipflow trace --pr-comment
```

The markdown form is suitable for inclusion in a PR description or audit document. The JSON form is suitable for piping into governance / compliance tooling. The `--pr-comment` form is a compact GitHub-friendly markdown block designed to be posted as a PR comment by CI (e.g. `shipflow trace --pr-comment | gh pr comment <pr> -F -`); it leads with approval state and a focused action list rather than the full matrix.

## What it shows

- **Per VP row**: bound slice(s), bound decision(s), grill session(s) that produced those decisions, generated test file(s) from the manifest, evidence file(s) named after the vp file, and any open artifact reviews on this target.
- **Approval state**: lists every active approval whose `pack_sha256` matches the current pack hash.
- **Orphans**: decisions with no `impacts`, slices with no existing vp files, reviews on missing vp paths. Each orphan is a signal that the substrate has drifted from the pack.

## Rules

- If a vp file shows `decisions: (none)`, propose either creating a new decision (`shipflow decision new`) or linking an existing one. A vp file without a decision is a red flag for the audit trail.
- If a vp file has open reviews, surface them before recommending `/shipflow:approve-pack`.
- Orphan decisions/slices indicate the team captured intent or judgment for surfaces that no longer exist (or never did). Either rebind them or supersede them.
- Use `shipflow trace --markdown` in PR descriptions to make the decision-to-test chain visible to reviewers.
