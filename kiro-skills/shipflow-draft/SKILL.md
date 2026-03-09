---
name: shipflow-draft
description: "Draft or refine a ShipFlow verification pack. Preferred follow-up skill: shipflow-implement."
---

# ShipFlow — Verification Collaboration

Use this skill when the user wants to define, add, remove, tighten, or finalize ShipFlow verifications.

## Intent

This phase finalizes the verification pack before implementation. Help the user shape a precise verification pack under `vp/`, or finalize it autonomously when the user explicitly wants that, then validate it with ShipFlow.

## Workflow

1. If the project has no `shipflow.json`, run:

```bash
shipflow init
```

2. Gather context before writing:
- read the user request
- review existing `vp/` files
- on an empty or low-signal greenfield repo, start with `shipflow draft --json "<user request>"`
- run `shipflow map --json "<user request>"` only when repo context matters, especially for brownfield work
- run `shipflow draft --json "<user request>"` when starter proposals would help
- run the installed `shipflow` CLI directly; if it is not on `PATH`, retry `~/.local/bin/shipflow` directly and do not inspect the wrapper or installed ShipFlow package

If the user is continuing an existing draft session, you may omit the request and let ShipFlow reuse the saved draft request.
If the user wants to restart the draft from scratch, use `shipflow draft --clear-session`.

3. Make it interactive before writing:
- first summarize what ShipFlow understood from the request and the repo
- on an empty or low-signal greenfield repo, do not dump all seven verification types immediately
- ask only the single highest-leverage next question from `shipflow draft --json` unless the user explicitly asks for a full review
- after each user answer, rerun `shipflow draft --json` with the refined request or reuse the saved draft session
- ask one focused question at a time, then narrow into the relevant verification types
- use the per-type discussion prompts as your checklist, not as a rigid script
- once the shape is clear, cover UI, behavior, API, database, performance, security, and technical progressively
- for each relevant type, ask what the user wants ShipFlow to verify and surface at most one or two best-practice prompts that ShipFlow returned
- then surface the top candidate verification files and biggest coverage gaps
- if `clarifications` are present and the user did not explicitly delegate the decision, ask concise clarification questions before writing
- if the user explicitly allows autonomous choices, say which defaults you are choosing, rerun `shipflow draft --json` with those choices folded into the scope, then materialize the selected proposals
- do not jump from `shipflow draft --json` straight into manual YAML authoring when ShipFlow already returned valid proposals
- do not present a long list of open questions spanning several verification types in one turn

4. Finalize proposals before writing:
- use `shipflow draft --accept=vp/path.yml` and `shipflow draft --reject=vp/path.yml` to record decisions
- use `shipflow draft --accept=vp/path.yml --write` to materialize an accepted proposal
- use `shipflow draft --accept=vp/path.yml --update-existing --write` only with explicit user approval when replacing an existing verification file
- use manual `vp/` editing only for focused refinements that `shipflow draft` did not already express cleanly
- do not inspect ShipFlow examples, templates, or source files to reverse-engineer the YAML format during a normal draft flow; use `shipflow draft`, `shipflow lint`, and `shipflow gen`
- prefer one observable behavior per file
- cover the relevant types: UI, behavior, API, database, performance, security, technical
- call out ambiguities instead of burying them
- do not jump straight to `--write` before the draft is finalized unless the user explicitly wants automatic materialization

5. Validate every pass:

```bash
shipflow lint
shipflow gen
```

6. Present a short summary:
- what was added or changed
- what is still ambiguous
- what is intentionally not covered yet

7. When the user is satisfied, move to the standard implementation loop with `shipflow-implement`.

## Rules

- Do not pretend the first draft is complete
- Do not optimize for check count; optimize for precision
- Prefer stable selectors and concrete assertions
- Do not replace an existing `vp/` file unless the user explicitly approved that update
- If validation fails, fix the pack before presenting it as ready
- Do not say ShipFlow “didn’t return AI-generated proposals” as a reason to abandon the draft workflow; local proposals are first-class
- Do not go mining example repos or installed templates as the primary drafting path when `shipflow draft` already returned valid proposals
