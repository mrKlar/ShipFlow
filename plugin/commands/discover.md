---
description: Brownfield — scan repo and propose regression VPs for existing surfaces
argument-hint: [(default scan) | list | show <id>]
allowed-tools: Read, Glob, Grep, Bash
---

# ShipFlow — Discover (brownfield onboarding)

Use this command on a repository that already has working code but no (or partial) verification pack. `discover` walks the source tree, surfaces existing UI routes, API endpoints, GraphQL endpoints, DB tables, auth/security signals, and technical contracts (CI, infra, build), and proposes a regression-style VP for each surface it finds.

This is the brownfield counterpart to `/shipflow:grill`: instead of producing constraints from intent, it produces constraints from **what the system already does**, so refactors do not silently change behavior the team relied on.

## Setup

Use the installed `shipflow` CLI directly. If it is not on `PATH`, retry as `~/.local/bin/shipflow`.

## Workflow

### Scan

```bash
shipflow discover
shipflow discover --json
```

Each scan writes a session under `.shipflow/discovered/<id>.json` so the proposals are durable and can be reviewed asynchronously.

### Inspect prior sessions

```bash
shipflow discover list
shipflow discover show <id>
```

### Promote a proposal into a vp scaffold

```bash
# By kind+target (precise):
shipflow discover promote <session-id> --kind=ui_route --target=/login

# By index (when there's only one of that kind):
shipflow discover promote <session-id> --index=0

# Single match by kind:
shipflow discover promote <session-id> --kind=auth_surface
```

The scaffolded file lands at the proposal's `suggested_path` (e.g. `vp/ui/regression-login.yml`). It is intentionally a minimal, schema-valid skeleton with **explicit TODO markers** in titles and assertions — `shipflow critique` will flag those via `critique.placeholder_present`, preventing approval until the user replaces them with real assertions for the observed behavior.

## What it proposes

- **ui_route** — for each detected UI route, a `vp/ui/regression-<slug>.yml` that locks rendering and core selectors.
- **api_endpoint** — for each detected REST endpoint, a `vp/api/regression-<METHOD>-<slug>.yml` that locks request/response shape.
- **graphql_endpoint** — for each detected GraphQL surface, a `vp/api/regression-graphql-<slug>.yml`.
- **db_table** — for each detected table, a `vp/db/regression-<slug>.yml` that locks row shape and invariants.
- **auth_surface** / **security_surface** — when auth or security signals are present, a baseline `vp/security/regression-*.yml` for current 401/403/redirect/header semantics.
- **technical_surface** — for detected CI / infra / build artifacts, a `vp/technical/regression-*.yml` that locks the contract.

## Rules

- Treat discovered proposals as **starting points**, not finished verifications. Each proposal still needs a real `assert` block reflecting current observed behavior.
- Surfaces already covered by a matching `vp/**/<file>.yml` are filtered out — `discover` will not re-propose them.
- After scanning, walk the user through the proposals and run `/shipflow:grill --role=qa` for any surface where the team is not sure what the current behavior actually is. Brownfield gaps tend to live exactly there.
- Pair `discover` with `/shipflow:slice` to group regression proposals by user-visible flow rather than by file.
