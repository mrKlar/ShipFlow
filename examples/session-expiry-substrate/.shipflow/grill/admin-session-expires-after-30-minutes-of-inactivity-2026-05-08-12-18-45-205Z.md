# Grill — Admin session expires after 30 minutes of inactivity

- **id:** `admin-session-expires-after-30-minutes-of-inactivity-2026-05-08-12-18-45-205Z`
- **role:** security
- **created:** 2026-05-08T12:18:45.205Z

## Intent

Admin session expires after 30 minutes of inactivity

## Questions (5)

### `q-security-1` — security

**Q:** What is the trust boundary of this feature — who can hit which endpoint or surface, with what credential?
**Why it matters:** Required framing for the security lens. Flag missing authorization checks, data exposure into logs/responses, abuse cases without verifications, and policy gates that are not yet wired.

**Answer:** _pending_

### `q-security-2` — security

**Q:** What sensitive data flows in, out, or into logs because of this change?
**Why it matters:** Required framing for the security lens. Flag missing authorization checks, data exposure into logs/responses, abuse cases without verifications, and policy gates that are not yet wired.

**Answer:** _pending_

### `q-security-3` — security

**Q:** What does the abuse case look like — a user, an insider, a partner with stolen credentials, a malicious payload?
**Why it matters:** Required framing for the security lens. Flag missing authorization checks, data exposure into logs/responses, abuse cases without verifications, and policy gates that are not yet wired.

**Answer:** _pending_

### `q-security-4` — security

**Q:** What policy or compliance regime governs this (PCI, SOC2, GDPR, internal) and which artifact captures the requirement?
**Why it matters:** Required framing for the security lens. Flag missing authorization checks, data exposure into logs/responses, abuse cases without verifications, and policy gates that are not yet wired.

**Answer:** _pending_

### `q-security-5` — security

**Q:** What is the rollback if this introduces a vulnerability we discover post-ship?
**Why it matters:** Required framing for the security lens. Flag missing authorization checks, data exposure into logs/responses, abuse cases without verifications, and policy gates that are not yet wired.

**Answer:** _pending_

## Findings (1)

- **`f-security-template` (assumption)** — Replace this entry with assumptions the team is making about security before drafting begins.

## Proposed decisions (0)

_No decisions proposed yet — intent may still be too ambiguous._
## Follow-ups

- Run shipflow grill --ai --role=security --intent="Admin session expires after 30 minutes of inactivity" once a provider is configured to extract real findings.
