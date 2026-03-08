# API + DB Service — ShipFlow Example

Canonical example focused on API contracts and database invariants.

Use it to see:
- `vp/api/*.yml` for HTTP contracts
- `vp/db/*.yml` for seed/before/action/after checks
- `vp/technical/*.yml` for CI/tooling constraints
- `vp/technical/architecture-boundaries.yml` for layered architecture checks with `tsarch`

Normal flow:

```bash
shipflow draft --write
shipflow implement
```

Technical notes:
- The CI example uses the built-in `custom` runner for repo constraints.
- The architecture example uses `runner.kind: archtest` with `framework: tsarch`.
- If you prefer another JS/TS architecture tool, the same pattern works with `dependency-cruiser`, `madge`, or `eslint-plugin-boundaries`.
