// Pure functions for the grill phase: role guidance, prompt assembly,
// offline template, and markdown transcript rendering. No file IO, no
// network, no CLI parsing — everything here is testable without a tmp
// directory or stubbed provider.

import { GRILL_ROLES } from "./schema/grill.zod.js";

export { GRILL_ROLES };

const ROLE_GUIDANCE = {
  general: {
    summary: "Cover product outcome, architecture impact, QA edge cases, security and risk in one pass.",
    must_ask: [
      "What user outcome proves this intent succeeded — and what proves it failed?",
      "What is explicitly NOT in scope, even if technically possible?",
      "What single failure of an upstream dependency would make this feature unsafe?",
    ],
    finding_focus: "Surface contradictions across product, architecture, and risk lenses; do not specialize.",
  },
  product: {
    summary: "Who the user is, what outcome they need, what tradeoffs the team is making for them.",
    must_ask: [
      "Who is the specific user this is for (role + context, not 'a user')?",
      "What does the user lose if we don't ship this — and how do they cope today?",
      "What outcome will we measure, on what timescale, against what baseline?",
      "What are we explicitly choosing NOT to support, and why is that an acceptable tradeoff?",
      "What does success look like for the worst 10% of cases (slow network, unfamiliar user, edge inputs)?",
    ],
    finding_focus: "Watch for value framings that hide who pays the cost, missing non-goals, and KPIs that are not falsifiable.",
  },
  architecture: {
    summary: "Boundaries, ownership, integration, failure modes, observability.",
    must_ask: [
      "Which existing component owns the new state, and why is it the right home?",
      "What integration boundary does this cross (service, schema, contract, queue)?",
      "What is the failure mode if the dependency on the other side of that boundary is slow or returns errors?",
      "What is observable from outside the box — logs, metrics, traces — and how do we tell which subsystem failed?",
      "What in the existing architecture should be deleted or refactored to make this honest, instead of layered on top?",
    ],
    finding_focus: "Flag implicit data ownership transfers, hidden cross-service writes, and integration points without a defined fallback.",
  },
  qa: {
    summary: "Edge cases, negative paths, race conditions, idempotency, regression risk.",
    must_ask: [
      "What is the negative case for the primary action — bad input, denied permission, expired session, partial failure?",
      "What happens when this action is retried or run concurrently by the same user from two devices?",
      "Which existing behavior could regress if we ship this — and what verification protects it today?",
      "What is the smallest concrete example that exercises the rule, including the result we expect to NOT see?",
      "Where does the system rely on time, ordering, or external state? What test pins that down?",
    ],
    finding_focus: "Surface happy-path-only assumptions, untested negative branches, and missing concrete examples.",
  },
  security: {
    summary: "Trust boundaries, authn/authz, data exposure, abuse cases, compliance.",
    must_ask: [
      "What is the trust boundary of this feature — who can hit which endpoint or surface, with what credential?",
      "What sensitive data flows in, out, or into logs because of this change?",
      "What does the abuse case look like — a user, an insider, a partner with stolen credentials, a malicious payload?",
      "What policy or compliance regime governs this (PCI, SOC2, GDPR, internal) and which artifact captures the requirement?",
      "What is the rollback if this introduces a vulnerability we discover post-ship?",
    ],
    finding_focus: "Flag missing authorization checks, data exposure into logs/responses, abuse cases without verifications, and policy gates that are not yet wired.",
  },
  risk: {
    summary: "Irreversible actions, blast radius, rollback strategy, dependencies.",
    must_ask: [
      "What is the largest irreversible action this feature can perform, and how is it gated?",
      "If this ships broken to 100% of users, what is the time-to-detect and time-to-rollback?",
      "Which downstream system is the most fragile dependency, and what is its current SLO?",
      "What rollout strategy reduces blast radius (flag, percentage, canary, dark)? Is it on by default?",
      "What single line of monitoring would page the right person when this misbehaves?",
    ],
    finding_focus: "Surface destructive defaults, irreversible writes without confirmation, missing rollback story, single-point-of-failure dependencies.",
  },
};

export function roleGuidance(role) {
  return ROLE_GUIDANCE[role] || ROLE_GUIDANCE.general;
}

export function buildGrillPrompt({ intent, role = "general", parent = null }) {
  const lines = [];
  lines.push("You are the AI facilitator in a ShipFlow Three-Amigos grilling session.");
  lines.push("");
  lines.push("Your job is NOT to draft a verification pack. Your job is to expose what the team");
  lines.push("does not yet share understanding about, BEFORE any verification YAML is written.");
  lines.push("");
  const guide = roleGuidance(role);
  lines.push(`Active role lens: ${role}`);
  lines.push(`  Mandate: ${guide.summary}`);
  lines.push(`  Finding focus: ${guide.finding_focus}`);
  lines.push("");
  lines.push("This role MUST ask at minimum the following framing questions (rephrase for the specific intent, do not skip):");
  for (const q of guide.must_ask) lines.push(`  - ${q}`);
  lines.push("");
  lines.push("Other lenses are run in separate sessions. Do not try to cover their territory; surface a follow-up if you sense a gap.");
  lines.push("");
  lines.push(`Intent under discussion:\n"""\n${intent}\n"""`);
  if (parent) {
    lines.push("");
    lines.push("Prior session context (for continuity, do not repeat already-resolved findings):");
    lines.push(JSON.stringify({
      questions: parent.questions,
      findings: parent.findings,
      proposed_decisions: parent.proposed_decisions,
    }, null, 2));
  }
  lines.push("");
  lines.push("Return ONLY valid JSON of this exact shape:");
  lines.push(`{
  "questions": [
    {
      "id": "q-<short-kebab-id>",
      "topic": "outcome|scope|integration|data|state|edge-case|security|rollout|...",
      "question": "Single, concrete question that forces a decision",
      "why_it_matters": "Why ambiguity here is dangerous"
    }
  ],
  "findings": [
    {
      "id": "f-<short-kebab-id>",
      "kind": "ambiguity|contradiction|edge_case|assumption|missing_negative_case|non_goal|risk",
      "text": "Concrete observation, not a generality",
      "evidence": "Quote or paraphrase from the intent that supports the finding"
    }
  ],
  "proposed_decisions": [
    {
      "id": "kebab-id",
      "type": "product|architecture|ux|security|data|process|other",
      "title": "Short title",
      "question": "What was the open question?",
      "decision": "What we should decide",
      "rationale": "Why this is the right call",
      "impacts": ["vp/<area>/<file>.yml"]
    }
  ],
  "follow_ups": ["Suggested next grill topics or external research items"]
}`);
  lines.push("");
  lines.push("Constraints:");
  lines.push("- At least 3 hard questions, none of them yes/no.");
  lines.push("- Surface at least one assumption the user may not realize they made.");
  lines.push("- Surface at least one negative or edge case.");
  lines.push("- Proposed decisions are OPTIONAL — only include them when the intent is concrete enough");
  lines.push("  to recommend a specific call. If everything is still ambiguous, leave the array empty.");
  lines.push("- Do NOT propose verification YAML. That is the job of the next phase.");
  lines.push("- Do NOT add markdown fences or commentary outside the JSON.");
  return lines.join("\n");
}

export function buildLocalGrillTemplate({ intent, role }) {
  const guide = roleGuidance(role);
  const questions = guide.must_ask.map((text, idx) => ({
    id: `q-${role}-${idx + 1}`,
    topic: role,
    question: text,
    why_it_matters: `Required framing for the ${role} lens. ${guide.finding_focus}`,
  }));
  return {
    questions,
    findings: [
      {
        id: `f-${role}-template`,
        kind: "assumption",
        text: `Replace this entry with assumptions the team is making about ${role} before drafting begins.`,
      },
    ],
    proposed_decisions: [],
    follow_ups: [
      `Run shipflow grill --ai --role=${role} --intent="${intent.replace(/"/g, "'").slice(0, 80)}" once a provider is configured to extract real findings.`,
    ],
  };
}

export function renderTranscriptMarkdown(session) {
  const lines = [];
  lines.push(`# Grill — ${session.intent}`);
  lines.push("");
  lines.push(`- **id:** \`${session.id}\``);
  lines.push(`- **role:** ${session.role}`);
  lines.push(`- **created:** ${session.created_at}`);
  if (session.provider) lines.push(`- **provider:** ${session.provider}${session.model ? ` (${session.model})` : ""}`);
  if (session.parent_session) lines.push(`- **parent:** ${session.parent_session}`);
  lines.push("");

  lines.push(`## Intent`);
  lines.push("");
  lines.push(session.intent);
  lines.push("");

  lines.push(`## Questions (${session.questions.length})`);
  lines.push("");
  if (session.questions.length === 0) lines.push("_No questions captured yet._");
  for (const q of session.questions) {
    lines.push(`### \`${q.id}\` — ${q.topic}`);
    lines.push("");
    lines.push(`**Q:** ${q.question}`);
    if (q.why_it_matters) lines.push(`**Why it matters:** ${q.why_it_matters}`);
    lines.push("");
    lines.push(`**Answer:** ${q.answer ? q.answer : "_pending_"}`);
    lines.push("");
  }

  lines.push(`## Findings (${session.findings.length})`);
  lines.push("");
  if (session.findings.length === 0) lines.push("_No findings captured yet._");
  for (const f of session.findings) {
    lines.push(`- **\`${f.id}\` (${f.kind})** — ${f.text}`);
    if (f.evidence) lines.push(`  - evidence: ${f.evidence}`);
    if (f.resolution) lines.push(`  - resolution: ${f.resolution}`);
  }
  lines.push("");

  lines.push(`## Proposed decisions (${session.proposed_decisions.length})`);
  lines.push("");
  if (session.proposed_decisions.length === 0) {
    lines.push("_No decisions proposed yet — intent may still be too ambiguous._");
  } else {
    for (const d of session.proposed_decisions) {
      lines.push(`### \`${d.id}\` (${d.type}) — ${d.title}`);
      lines.push(`- **question:** ${d.question}`);
      lines.push(`- **decision:** ${d.decision}`);
      lines.push(`- **rationale:** ${d.rationale}`);
      if (d.impacts?.length) lines.push(`- **impacts:** ${d.impacts.join(", ")}`);
      if (d.notes) lines.push(`- **notes:** ${d.notes}`);
      lines.push("");
      lines.push("Promote this proposal with:");
      lines.push("");
      lines.push("```bash");
      const args = [
        `--id=${d.id}`,
        `--type=${d.type}`,
        `--title=${JSON.stringify(d.title)}`,
        `--question=${JSON.stringify(d.question)}`,
        `--decision=${JSON.stringify(d.decision)}`,
        `--rationale=${JSON.stringify(d.rationale)}`,
        `--source=grill`,
        `--source-ref=${session.id}`,
      ];
      for (const i of d.impacts || []) args.push(`--impacts=${i}`);
      lines.push(`shipflow decision new ${args.join(" ")}`);
      lines.push("```");
      lines.push("");
    }
  }

  if (session.follow_ups?.length) {
    lines.push(`## Follow-ups`);
    lines.push("");
    for (const f of session.follow_ups) lines.push(`- ${f}`);
    lines.push("");
  }

  return lines.join("\n");
}
