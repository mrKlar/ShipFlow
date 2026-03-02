# VP Ultra Pure v1 (ShipFlow)

## Canon
Only `vp/` is human-readable and reviewed.
Everything else is build output or opaque implementation.

Required folders in app repo:
- `vp/`       : verification pack (reviewed)
- `.gen/`     : generated verifiers (do not edit manually)
- `evidence/` : verification outputs (do not edit manually)

## Verification languages (human-readable)
- UI/Feature: `vp/ui/*.yml` (ShipFlow DSL, closed vocabulary)
- API: `vp/api/openapi.yaml`, `vp/api/*.schema.json`
- Data: `vp/data/*.sql` (+ optional metadata YAML)
- NFR: `vp/nfr/*.yml` (budgets/scenarios)
- Policy: `vp/policy/*.rego` (OPA/Rego)

## Generated (opaque)
- `.gen/playwright/*.spec.ts` from UI DSL
- `.gen/k6/*.js` from NFR DSL (v1 stub)
- `.gen/vp.lock.json` (hash of VP)

## Execution
`shipflow verify` must:
1) validate VP lock (VP unchanged since `gen`)
2) run policy gate (optional in v1; integration point exists)
3) run generated verifiers
4) emit evidence JSON

## Anti-triche invariants (enforced by adapters/CI)
- Implementation phase MUST NOT modify: `vp/**`, `.gen/**`, `evidence/**`
- `.gen/**` is regenerated only via `shipflow gen`
- Only one merge gate uses `shipflow verify` results
