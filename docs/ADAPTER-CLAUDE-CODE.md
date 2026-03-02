# Adapter guide: Claude Code (ShipFlow v1)

Goal: make ShipFlow **fail-closed** in Claude Code by enforcing:
- Implementer cannot modify `vp/`, `.gen/`, `evidence/`
- Require `shipflow verify` success before ending

Claude Code supports hooks such as `PreToolUse` and `Stop` that can block or modify tool usage.
See Claude Code hooks documentation for details.

Recommended policy:
1) Block file edits under `vp/`, `.gen/`, `evidence/` during implementation phase.
2) On `Stop`, run:
   - `npm run shipflow:gen`
   - `npm run shipflow:verify`
   and block stop if not green.

Implementation: install a hook script that inspects the pending diff / changed files and denies if policy violated.
