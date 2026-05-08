---
description: Score the cognitive quality of the verification pack
allowed-tools: Read, Glob, Grep, Bash
---

# ShipFlow — Critique

Use this command after `/shipflow:lint` passes but before `/shipflow:approve-pack`. Lint tells you the YAML is well-formed. Critique tells you whether the pack is *cognitively trustworthy* — i.e. whether it could pass green and still ship the wrong outcome.

Critique is the layer that prevents YAML theater.

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

```bash
shipflow critique --json
shipflow critique --threshold=85   # exit non-zero when score < 85, suitable for CI
```

The `--threshold=N` flag (also `SHIPFLOW_CRITIQUE_THRESHOLD=N` env var) makes critique a CI gate: any score below `N` exits 1. **Errors always fail** regardless of the threshold — a placeholder in YAML cannot sneak past a permissive setting.

Then summarize for the user:
- the score (`strong | ok | weak | fragile`),
- the count of negative-case checks vs total,
- the decision-linkage ratio (how many vp files have a `.shipflow/decisions/*.yml` impact pointing at them),
- which findings to address first.

## Heuristics enforced

- `critique.no_decision_link` — vp file with no decision linked. Bind via `shipflow decision link <id> --vp=<file>`.
- `critique.happy_path_only` — pack contains zero negative-case checks (no ids/titles signalling error/invalid/denied/etc.).
- `critique.behavior_no_negative` / `critique.api_no_negative` / `critique.security_no_negative` — area has 2+ checks but no negative case.
- `critique.vague_title` — generic titles ("works", "should work", "happy path", "ok", "smoke") that name no observable outcome.
- `critique.placeholder_present` — `TODO`, `TBD`, `<some>`, `[example]` left in YAML. Treated as **error**.
- `critique.security_without_policy` — security checks present but no `vp/policy/*.rego` gate.
- `critique.decision_unlinked` — decision exists but does not impact any vp file.

## Rules

- Treat critique findings as serious feedback, not warnings to silence. A score under 70 is a signal that approval should wait.
- For each `critique.no_decision_link` finding, propose either creating a new decision (`shipflow decision new`) or linking an existing one (`shipflow decision link`).
- For `critique.happy_path_only`, push back to `/shipflow:grill` to surface negative cases the team has not yet articulated.
- `critique.placeholder_present` is an **error**, not a warning. Do not approve a pack containing placeholders.
