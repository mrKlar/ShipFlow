import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { GrillSession, GRILL_ROLES } from "./schema/grill.zod.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { bold, dim, green, yellow, red } from "./util/color.js";
import { parseFlags, relPath } from "./util/cli.js";
import { slugify, timestampStamp } from "./util/id.js";
import { readConfig } from "./config.js";
import { createDecision } from "./decisions.js";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  generateWithProvider,
  resolveProviderModel,
  resolveProviderName,
} from "./providers/index.js";

const GRILL_DIR = path.join(".shipflow", "grill");

export function grillDir(cwd) {
  return path.join(cwd, GRILL_DIR);
}

export function listGrillFiles(cwd) {
  const dir = grillDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => path.join(dir, f))
    .sort();
}

export function loadGrillSessions(cwd) {
  const issues = [];
  const items = [];
  for (const file of listGrillFiles(cwd)) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err) {
      issues.push({ file, code: "json.parse_error", message: String(err?.message || err) });
      continue;
    }
    try {
      const parsed = GrillSession.parse(raw);
      items.push({ ...parsed, __file: file });
    } catch (err) {
      if (err instanceof z.ZodError) {
        for (const issue of err.issues) {
          issues.push({
            file,
            code: "schema.invalid",
            message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
          });
        }
      } else {
        issues.push({ file, code: "schema.invalid", message: String(err?.message || err) });
      }
    }
  }
  return { items, issues };
}

export function findGrillSession(cwd, id) {
  const { items } = loadGrillSessions(cwd);
  return items.find(d => d.id === id) || null;
}

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

// GRILL_ROLES is re-exported from the schema so callers can import either path.
export { GRILL_ROLES };

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

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function renderTranscriptMarkdown(session) {
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

export async function createGrillSession(cwd, {
  intent,
  role = "general",
  ai = false,
  provider: providerOverride,
  model: modelOverride,
  parentId = null,
  now = new Date(),
  generateText = generateWithProvider,
} = {}) {
  if (!intent || !intent.trim()) {
    throw new Error("intent is required (non-empty)");
  }
  if (!GRILL_ROLES.includes(role)) {
    throw new Error(`role must be one of: ${GRILL_ROLES.join(", ")}`);
  }
  const slug = slugify(intent, "grill");
  const stamp = timestampStamp(now);
  const id = `${slug}-${stamp}`;
  const dir = grillDir(cwd);
  mkdirp(dir);
  const jsonFile = path.join(dir, `${id}.json`);
  const mdFile = path.join(dir, `${id}.md`);

  let parent = null;
  if (parentId) {
    parent = findGrillSession(cwd, parentId);
    if (!parent) throw new Error(`Parent grill session not found: ${parentId}`);
  }

  let body = buildLocalGrillTemplate({ intent, role });
  let usedProvider;
  let usedModel;

  if (ai) {
    const config = readConfig(cwd);
    const aiProvider = resolveProviderName(providerOverride || config.draft?.aiProvider || config.impl?.provider || "auto", cwd);
    const aiModel = resolveProviderModel(config.draft, aiProvider, {
      model: modelOverride,
      envModel: process.env.SHIPFLOW_DRAFT_MODEL,
    });
    const timeoutMs = config.draft?.timeoutMs || config.impl?.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS;
    const prompt = buildGrillPrompt({ intent, role, parent });
    const response = await generateText({
      provider: aiProvider,
      model: aiModel,
      maxTokens: 4096,
      prompt,
      cwd,
      responseFormat: "json",
      timeoutMs,
    });
    const parsed = extractJson(response);
    if (!parsed) {
      throw new Error("Grill provider returned non-JSON output. Re-run with a different model or use the offline template.");
    }
    body = {
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      proposed_decisions: Array.isArray(parsed.proposed_decisions) ? parsed.proposed_decisions : [],
      follow_ups: Array.isArray(parsed.follow_ups) ? parsed.follow_ups : [],
    };
    usedProvider = aiProvider;
    usedModel = aiModel || undefined;
  }

  const session = GrillSession.parse({
    id,
    intent: intent.trim(),
    role,
    created_at: now.toISOString(),
    provider: usedProvider,
    model: usedModel,
    questions: body.questions,
    findings: body.findings,
    proposed_decisions: body.proposed_decisions,
    follow_ups: body.follow_ups,
    parent_session: parentId || undefined,
  });

  writeFile(jsonFile, JSON.stringify(session, null, 2) + "\n");
  writeFile(mdFile, renderTranscriptMarkdown(session));

  return { session, jsonFile, mdFile };
}

function joinNonFlag(args) {
  return args.filter(a => !a.startsWith("--")).join(" ").trim();
}

export async function grillCli({ cwd, args, json = false, deps = {} }) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "list") {
    const flags = parseFlags(rest);
    const { items, issues } = loadGrillSessions(cwd);
    if (json || flags.json) {
      process.stdout.write(JSON.stringify({
        sessions: items.map(d => ({ ...d, __file: relPath(cwd, d.__file) })),
        issues: issues.map(i => ({ ...i, file: relPath(cwd, i.file) })),
      }, null, 2) + "\n");
      return { exitCode: issues.length > 0 ? 1 : 0 };
    }
    if (items.length === 0 && issues.length === 0) {
      console.log(dim('No grill sessions yet. Run `shipflow grill "<intent>"` to start one.'));
      return { exitCode: 0 };
    }
    console.log(bold(`Grill sessions (${items.length})`));
    for (const d of items) {
      console.log(`  ${bold(d.id)}  ${dim(`[${d.role}]`)}`);
      console.log(`    ${d.intent.slice(0, 100)}${d.intent.length > 100 ? "…" : ""}`);
      console.log(dim(`    ${d.questions.length} question(s), ${d.findings.length} finding(s), ${d.proposed_decisions.length} proposed decision(s)`));
    }
    if (issues.length > 0) {
      console.log("");
      console.log(red(`Issues (${issues.length}):`));
      for (const issue of issues) console.log(`  ${relPath(cwd, issue.file)}: ${issue.code}: ${issue.message}`);
      return { exitCode: 1 };
    }
    return { exitCode: 0 };
  }

  if (sub === "show") {
    const id = rest.find(a => !a.startsWith("--"));
    if (!id) {
      console.error("usage: shipflow grill show <id>");
      return { exitCode: 2 };
    }
    const session = findGrillSession(cwd, id);
    if (!session) {
      console.error(`Grill session not found: ${id}`);
      return { exitCode: 1 };
    }
    if (json) {
      process.stdout.write(JSON.stringify({ ...session, __file: relPath(cwd, session.__file) }, null, 2) + "\n");
      return { exitCode: 0 };
    }
    console.log(renderTranscriptMarkdown(session));
    return { exitCode: 0 };
  }

  if (sub === "promote") {
    const id = rest.find(a => !a.startsWith("--"));
    const flags = parseFlags(rest);
    if (!id || !flags["decision"]) {
      console.error('usage: shipflow grill promote <session-id> --decision=<proposed-decision-id>');
      return { exitCode: 2 };
    }
    const session = findGrillSession(cwd, id);
    if (!session) {
      console.error(`Grill session not found: ${id}`);
      return { exitCode: 1 };
    }
    const proposed = session.proposed_decisions.find(d => d.id === flags["decision"]);
    if (!proposed) {
      console.error(`Proposed decision not found in session: ${flags["decision"]}`);
      return { exitCode: 1 };
    }
    try {
      const { file, decision } = createDecision(cwd, {
        ...proposed,
        source: "grill",
        source_ref: session.id,
      });
      if (json) {
        process.stdout.write(JSON.stringify({ created: relPath(cwd, file), decision }, null, 2) + "\n");
      } else {
        console.log(green(`Promoted to decision: ${decision.id}`));
        console.log(dim(`  ${relPath(cwd, file)}`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  // Default: create new grill session.
  // Forms supported:
  //   shipflow grill "intent text"
  //   shipflow grill new "intent text" [--ai] [--role=...] [--parent=<id>]
  //   shipflow grill --intent="..." [--ai] [--role=...]
  let inputArgs = sub === "new" ? rest : args;
  const flags = parseFlags(inputArgs);
  const intentFromFlag = flags.intent;
  const intentFromPositional = joinNonFlag(inputArgs);
  const intent = intentFromFlag || intentFromPositional;
  if (!intent) {
    console.error('usage: shipflow grill "<intent>" [--ai] [--role=general|product|architecture|qa|security|risk] [--parent=<session-id>]');
    return { exitCode: 2 };
  }

  const role = flags.role || "general";
  const parentId = flags.parent || null;
  const ai = Boolean(flags.ai);

  try {
    const { session, jsonFile, mdFile } = await createGrillSession(cwd, {
      intent,
      role,
      ai,
      provider: flags.provider,
      model: flags.model,
      parentId,
      generateText: deps.generateText,
    });
    if (json) {
      process.stdout.write(JSON.stringify({
        created: { json: relPath(cwd, jsonFile), md: relPath(cwd, mdFile) },
        session,
      }, null, 2) + "\n");
    } else {
      console.log(green(`Grill session created: ${session.id}`));
      console.log(dim(`  ${relPath(cwd, mdFile)}`));
      console.log(dim(`  ${relPath(cwd, jsonFile)}`));
      if (!ai) {
        console.log(yellow("  (offline template — re-run with --ai to ask the configured provider)"));
      }
      console.log("");
      console.log(`  ${session.questions.length} question(s), ${session.findings.length} finding(s), ${session.proposed_decisions.length} proposed decision(s)`);
      if (session.proposed_decisions.length > 0) {
        console.log(dim("  Promote a proposed decision with: shipflow grill promote " + session.id + " --decision=<id>"));
      }
    }
    return { exitCode: 0 };
  } catch (err) {
    console.error(String(err?.message || err));
    return { exitCode: 1 };
  }
}
