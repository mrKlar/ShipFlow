# API + DB Service — ShipFlow Example

Canonical example focused on API contracts and database invariants.

Use it to see:
- `vp/api/*.yml` for HTTP contracts
- `vp/db/*.yml` for seed/before/action/after checks
- `vp/technical/*.yml` for CI/tooling constraints

Normal flow:

```bash
shipflow draft --write
shipflow implement
```
