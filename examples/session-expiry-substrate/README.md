# Session Expiry — Substrate Example

This example is the **after** snapshot of the [walkthrough in the User Guide](../../docs/USER-GUIDE.md#walkthrough--understanding-to-verification-in-10-minutes). It demonstrates what a verification pack looks like once the **understanding-to-verification substrate** is wired up: grill transcript, durable decision, vertical slice, all linked to two narrow `vp/` files.

The companion example [`todo-app`](../todo-app) demonstrates the **implementation** side (`src/` regenerated from `vp/`). This example demonstrates the **substrate** side (`.shipflow/` populated with the human judgment that produced the pack).

## What's in here

```text
session-expiry-substrate/
├── README.md
├── shipflow.json                                # framework config
├── vp/
│   ├── security/session-timeout.yml             # API rejects stale cookies
│   └── ui/session-expired-modal.yml             # UI shows the re-login modal
└── .shipflow/
    ├── grill/
    │   ├── admin-session-...-security.json      # security-lens transcript (JSON)
    │   └── admin-session-...-security.md        # same, walkable markdown
    ├── decisions/
    │   └── 0001-session-inactivity-30m.yml      # durable decision (linked to both vp files)
    └── slices/
        └── session-expiry.yml                   # vertical slice tying it all together
```

## Why no `approvals/`

`shipflow approve-pack` records a sha256 of the current `vp/**` content into the approval file. Committing a pre-built approval here would be tied to **this snapshot** of the pack — anyone who tweaks the YAML for their own learning would invalidate it immediately, which is confusing.

Instead, run `shipflow approve-pack --approver=<you> --role=architect` yourself once you have the example checked out. That captures the live demo of the approval / re-approval cycle.

## What this teaches

Walk the files in this order:

1. **`vp/security/session-timeout.yml` and `vp/ui/session-expired-modal.yml`** — the two narrow contracts the AI implementation must pass. One negative-case API check, one UI rendering check.

2. **`.shipflow/grill/admin-session-...-security.md`** — the security-lens framing the team grilled before drafting. Five mandatory questions surfaced, plus one assumption to nail down. Read it as if you were stepping into the team's preparation.

3. **`.shipflow/decisions/0001-session-inactivity-30m.yml`** — the durable answer. Notice `source: grill` and `source_ref: <session-id>` link back to the transcript. `impacts: [vp/security/session-timeout.yml, vp/ui/session-expired-modal.yml]` is what `shipflow trace` joins on.

4. **`.shipflow/slices/session-expiry.yml`** — the user-visible outcome (`goal:`) tied to vp + decision + grill. This is what a reviewer audits before giving final approval.

## Run it

From this directory:

```bash
shipflow status
shipflow critique --threshold=85
shipflow trace --pr-comment
```

`shipflow trace --pr-comment` will show ⚠️ until you run `shipflow approve-pack` because no approval is committed. Sign it once and re-run to see ✅ with no outstanding actions.

To extend the example into a runnable app, add an `src/` that satisfies the two `vp/` contracts (a minimal Node server with `/admin` and `/api/admin/me`), then `shipflow gen && shipflow verify`. The point of the substrate example is not the runtime — it's the audit trail that comes BEFORE the runtime exists.

## See also

- [Walkthrough — Understanding-to-Verification in 10 Minutes](../../docs/USER-GUIDE.md#walkthrough--understanding-to-verification-in-10-minutes)
- [Verification Pack reference](../../docs/VERIFICATION-PACK.md)
- [`todo-app`](../todo-app) — the implementation-side example
