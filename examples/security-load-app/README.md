# Security + Load App — ShipFlow Example

Canonical example focused on access control, response hardening, and smoke performance budgets.

It includes a reviewed pack plus current generated artifacts under `.gen/`:
- `vp/security/*.yml` for auth/authz checks
- `vp/nfr/*.yml` for smoke performance budgets
- `vp/technical/*.yml` for supporting technical constraints

Normal flow:

```bash
shipflow implement
```

If you want to evolve the committed pack instead of using it as-is:

```bash
shipflow draft "<change request>"
shipflow draft --accept=vp/path.yml --write
shipflow implement
```
