import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { GrillSession } from "./schema/grill.zod.js";
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
import {
  GRILL_ROLES,
  roleGuidance,
  buildGrillPrompt,
  buildLocalGrillTemplate,
  renderTranscriptMarkdown,
} from "./grill-prompt.js";

// Re-export pure helpers so existing call sites keep working.
export {
  GRILL_ROLES,
  roleGuidance,
  buildGrillPrompt,
  buildLocalGrillTemplate,
  renderTranscriptMarkdown,
};

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

export async function createGrillSession(cwd, {
  intent,
  role = "general",
  ai = false,
  provider: providerOverride,
  model: modelOverride,
  parentId = null,
  now = new Date(),
  // idSuffix is appended to the generated id and disambiguates synchronous
  // createGrillSession calls inside the same millisecond (used by multi-mode
  // fan-out where five sessions are created back-to-back with the same
  // intent but different roles).
  idSuffix = null,
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
  const id = idSuffix ? `${slug}-${stamp}-${idSuffix}` : `${slug}-${stamp}`;
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

  // Write the human-readable transcript first; only commit the canonical .json
  // last so listGrillFiles never indexes a session whose .md is missing.
  writeFile(mdFile, renderTranscriptMarkdown(session));
  writeFile(jsonFile, JSON.stringify(session, null, 2) + "\n");

  return { session, jsonFile, mdFile };
}

function joinNonFlag(args) {
  return args.filter(a => !a.startsWith("--")).join(" ").trim();
}

// Roles that the --multi flag fans out to. "general" is intentionally
// excluded because multi IS the deliberate breakdown of perspectives;
// running "general" alongside the specialists would produce duplicate
// findings with no extra signal.
const MULTI_ROLES = ["product", "architecture", "qa", "security", "risk"];

export async function createMultiGrillSession(cwd, {
  intent,
  ai = false,
  provider: providerOverride,
  model: modelOverride,
  now = new Date(),
  generateText = generateWithProvider,
} = {}) {
  if (!intent || !intent.trim()) {
    throw new Error("intent is required (non-empty)");
  }
  const sessions = [];
  for (const role of MULTI_ROLES) {
    // Each session gets the role suffix so five back-to-back creates inside
    // the same millisecond never collide on disk.
    const result = await createGrillSession(cwd, {
      intent,
      role,
      ai,
      provider: providerOverride,
      model: modelOverride,
      now,
      idSuffix: role,
      generateText,
    });
    sessions.push(result);
  }
  return { sessions, roles: MULTI_ROLES };
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
      // Explicit pick of fields known to Decision schema. Spreading the whole
      // proposed object would crash under Decision's strict mode if a future
      // GrillProposedDecision field had no Decision counterpart.
      const { file, decision } = createDecision(cwd, {
        id: proposed.id,
        type: proposed.type,
        title: proposed.title,
        question: proposed.question,
        decision: proposed.decision,
        rationale: proposed.rationale,
        impacts: proposed.impacts,
        notes: proposed.notes,
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
  const multi = Boolean(flags.multi);

  if (multi) {
    if (flags.role) {
      console.error("--multi cannot be combined with --role; --multi fans out to product, architecture, qa, security, risk.");
      return { exitCode: 2 };
    }
    if (parentId) {
      console.error("--multi cannot be combined with --parent; each fan-out session is a top-level lens.");
      return { exitCode: 2 };
    }
    try {
      const { sessions, roles } = await createMultiGrillSession(cwd, {
        intent,
        ai,
        provider: flags.provider,
        model: flags.model,
        generateText: deps.generateText,
      });
      if (json) {
        process.stdout.write(JSON.stringify({
          multi: true,
          roles,
          sessions: sessions.map(s => ({
            role: s.session.role,
            id: s.session.id,
            json: relPath(cwd, s.jsonFile),
            md: relPath(cwd, s.mdFile),
            questions: s.session.questions.length,
            findings: s.session.findings.length,
            proposed_decisions: s.session.proposed_decisions.length,
          })),
        }, null, 2) + "\n");
      } else {
        console.log(green(`Multi-grill: ${sessions.length} session(s) created across ${roles.join(", ")}`));
        for (const { session, mdFile } of sessions) {
          console.log(`  ${bold(session.role.padEnd(13))} ${session.id}`);
          console.log(dim(`                ${relPath(cwd, mdFile)}`));
          console.log(dim(`                ${session.questions.length} question(s), ${session.findings.length} finding(s), ${session.proposed_decisions.length} proposed decision(s)`));
        }
        if (!ai) {
          console.log(yellow("  (offline templates — re-run with --multi --ai once a provider is configured)"));
        }
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

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
