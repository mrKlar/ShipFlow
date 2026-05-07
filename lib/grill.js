import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { GrillSession } from "./schema/grill.zod.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { bold, dim, green, yellow, red } from "./util/color.js";
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

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "grill";
}

function timestampStamp(date = new Date()) {
  const iso = date.toISOString();
  return iso.replace(/[:T]/g, "-").replace(/\..+$/, "Z");
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

export function buildGrillPrompt({ intent, role = "general", parent = null }) {
  const lines = [];
  lines.push("You are the AI facilitator in a ShipFlow Three-Amigos grilling session.");
  lines.push("");
  lines.push("Your job is NOT to draft a verification pack. Your job is to expose what the team");
  lines.push("does not yet share understanding about, BEFORE any verification YAML is written.");
  lines.push("");
  lines.push(`Active role lens: ${role}`);
  lines.push("- general: cover product outcome, architecture impact, QA edge cases, security/risk");
  lines.push("- product: who is the user, what outcome, what is explicitly NOT in scope, what tradeoffs");
  lines.push("- architecture: integration points, boundaries, data ownership, failure modes, observability");
  lines.push("- qa: negative cases, race conditions, idempotency, regression risk, observable behavior");
  lines.push("- security: trust boundaries, authn/authz, data exposure, abuse cases, compliance");
  lines.push("- risk: irreversible actions, blast radius, rollback strategy, dependencies");
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
  return {
    questions: [
      {
        id: "q-outcome",
        topic: "outcome",
        question: "What user outcome proves this intent succeeded?",
        why_it_matters: "Without an outcome, the team cannot tell a passing pack from a useful one.",
      },
      {
        id: "q-scope",
        topic: "scope",
        question: "What is explicitly NOT in scope of this work?",
        why_it_matters: "Non-goals prevent the verification pack from drifting into adjacent surfaces.",
      },
      {
        id: "q-failure",
        topic: "edge-case",
        question: "What does the system do when the primary path fails?",
        why_it_matters: "Negative behavior is where most production incidents originate.",
      },
    ],
    findings: [
      {
        id: "f-template",
        kind: "assumption",
        text: "Replace this entry with assumptions the team is making before drafting begins.",
      },
    ],
    proposed_decisions: [],
    follow_ups: [
      `Run shipflow grill --ai --intent="${intent.replace(/"/g, "'").slice(0, 80)}" --role=${role} once a provider is configured to extract real findings.`,
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
  const slug = slugify(intent);
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

function relPath(cwd, file) {
  return path.relative(cwd, file).replaceAll("\\", "/");
}

function parseFlags(args) {
  const flags = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) {
        flags[arg.slice(2)] = true;
      } else {
        const key = arg.slice(2, eq);
        const val = arg.slice(eq + 1);
        if (flags[key] === undefined) flags[key] = val;
        else if (Array.isArray(flags[key])) flags[key].push(val);
        else flags[key] = [flags[key], val];
      }
    }
  }
  return flags;
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
