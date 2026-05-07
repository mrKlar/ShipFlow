import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { UiCheck } from "./schema/ui-check.zod.js";
import { BehaviorCheck } from "./schema/behavior-check.zod.js";
import { ApiCheck } from "./schema/api-check.zod.js";
import { DbCheck } from "./schema/db-check.zod.js";
import { DomainCheck } from "./schema/domain-check.zod.js";
import { NfrCheck } from "./schema/nfr-check.zod.js";
import { SecurityCheck } from "./schema/security-check.zod.js";
import { TechnicalCheck } from "./schema/technical-check.zod.js";
import { loadDecisions } from "./decisions.js";
import { bold, green, yellow, red, dim } from "./util/color.js";

const NEGATIVE_KEYWORDS = [
  "error", "fail", "failure", "invalid", "unauthorized", "forbidden", "denied",
  "missing", "not-found", "notfound", "bad", "rate-limit", "ratelimit",
  "timeout", "expired", "blocked", "rejected", "negative", "edge",
];

const VAGUE_TITLE_PATTERNS = [
  /\bworks?\b/i,
  /\bis correct\b/i,
  /\bhappy path\b/i,
  /\bshould work\b/i,
  /\bok\b/i,
  /\bbasic\b/i,
  /\bsmoke\b/i,
];

const PLACEHOLDER_TOKENS = [
  /<\s*(?:some|fill|placeholder|todo|x{2,})\s*>/i,
  /\bTODO\b/,
  /\bTBD\b/,
  /\[example\]/i,
];

function listYaml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(f => path.join(dir, f))
    .sort();
}

function tryParse(file, schema) {
  try {
    const raw = yaml.load(fs.readFileSync(file, "utf-8"));
    const parsed = schema.parse(raw);
    parsed.__file = file;
    return parsed;
  } catch {
    return null;
  }
}

function relPath(cwd, file) {
  return path.relative(cwd, file).replaceAll("\\", "/");
}

export function loadParsedPack(cwd) {
  const vpDir = path.join(cwd, "vp");
  const buckets = {
    ui: { schema: UiCheck, files: listYaml(path.join(vpDir, "ui")) },
    behavior: { schema: BehaviorCheck, files: listYaml(path.join(vpDir, "behavior")) },
    api: { schema: ApiCheck, files: listYaml(path.join(vpDir, "api")) },
    db: { schema: DbCheck, files: listYaml(path.join(vpDir, "db")) },
    domain: { schema: DomainCheck, files: listYaml(path.join(vpDir, "domain")) },
    nfr: { schema: NfrCheck, files: listYaml(path.join(vpDir, "nfr")) },
    security: { schema: SecurityCheck, files: listYaml(path.join(vpDir, "security")) },
    technical: { schema: TechnicalCheck, files: listYaml(path.join(vpDir, "technical")) },
  };
  const checks = [];
  for (const [type, { schema, files }] of Object.entries(buckets)) {
    for (const file of files) {
      // ui has _fixtures subdir; skip it here
      if (type === "ui" && file.includes(`${path.sep}_fixtures${path.sep}`)) continue;
      const parsed = tryParse(file, schema);
      if (parsed) {
        parsed.__type = type;
        checks.push(parsed);
      }
    }
  }
  const policyFiles = fs.existsSync(path.join(vpDir, "policy"))
    ? fs.readdirSync(path.join(vpDir, "policy")).filter(f => f.endsWith(".rego")).map(f => path.join(vpDir, "policy", f))
    : [];
  return { checks, policyFiles, vpDir };
}

function looksNegative(text) {
  const t = String(text || "").toLowerCase();
  return NEGATIVE_KEYWORDS.some(kw => t.includes(kw));
}

function vagueTitle(title) {
  if (!title) return false;
  return VAGUE_TITLE_PATTERNS.some(re => re.test(title)) && title.split(/\s+/).length <= 5;
}

function hasPlaceholders(value) {
  if (typeof value === "string") {
    return PLACEHOLDER_TOKENS.some(re => re.test(value));
  }
  if (!value || typeof value !== "object") return false;
  for (const v of Array.isArray(value) ? value : Object.values(value)) {
    if (hasPlaceholders(v)) return true;
  }
  return false;
}

function buildDecisionImpactsIndex(decisions) {
  const index = new Map();
  for (const d of decisions) {
    for (const impact of d.impacts || []) {
      const key = impact.replaceAll("\\", "/");
      const set = index.get(key) || new Set();
      set.add(d.id);
      index.set(key, set);
    }
  }
  return index;
}

export function runCritique(cwd) {
  const { checks, policyFiles } = loadParsedPack(cwd);
  const { items: decisions } = loadDecisions(cwd);
  const decisionIndex = buildDecisionImpactsIndex(decisions);

  const findings = [];
  function add(level, code, file, message, meta = {}) {
    findings.push({ level, code, file, message, ...meta });
  }

  if (checks.length === 0) {
    return {
      ok: false,
      summary: { score: 0, level: "empty", checks: 0, findings: 0 },
      findings: [],
      checks: [],
      decisions: { total: decisions.length, linked_files: 0 },
      message: "No verification pack present. Nothing to critique.",
    };
  }

  // Heuristic 1: decision linkage per file
  let linkedFiles = 0;
  for (const check of checks) {
    const rel = relPath(cwd, check.__file);
    if (decisionIndex.has(rel)) {
      linkedFiles += 1;
    } else {
      add(
        "warn",
        "critique.no_decision_link",
        rel,
        "No .shipflow/decisions/*.yml impacts this verification. Link a decision via shipflow decision link <id> --vp=" + rel,
      );
    }
  }

  // Heuristic 2: vague titles
  for (const check of checks) {
    if (vagueTitle(check.title)) {
      add(
        "warn",
        "critique.vague_title",
        relPath(cwd, check.__file),
        `Title "${check.title}" is too generic. Name the observable outcome being asserted.`,
      );
    }
  }

  // Heuristic 3: placeholders / TODOs left in YAML
  for (const check of checks) {
    if (hasPlaceholders(check)) {
      add(
        "error",
        "critique.placeholder_present",
        relPath(cwd, check.__file),
        "Placeholder tokens (TODO/TBD/<...>) found. Replace with concrete values before approval.",
      );
    }
  }

  // Heuristic 4: happy-path-only — pack as a whole has zero negative-looking ids/titles
  const negativeChecks = checks.filter(c => looksNegative(c.id) || looksNegative(c.title));
  if (negativeChecks.length === 0) {
    add(
      "warn",
      "critique.happy_path_only",
      "vp/",
      "Pack contains no negative-case checks (no ids/titles signalling error, invalid, denied, expired, etc.). Add at least one failure-path verification.",
    );
  }

  // Heuristic 5: per-area negative coverage for behavior/api
  for (const area of ["behavior", "api", "security"]) {
    const inArea = checks.filter(c => c.__type === area);
    if (inArea.length >= 2) {
      const hasNeg = inArea.some(c => looksNegative(c.id) || looksNegative(c.title));
      if (!hasNeg) {
        add(
          "warn",
          `critique.${area}_no_negative`,
          `vp/${area}/`,
          `Area ${area}/ has ${inArea.length} checks but none signal a negative/error case.`,
        );
      }
    }
  }

  // Heuristic 6: security checks present but no policy gate
  const securityChecks = checks.filter(c => c.__type === "security");
  if (securityChecks.length > 0 && policyFiles.length === 0) {
    add(
      "warn",
      "critique.security_without_policy",
      "vp/security/",
      `Pack has ${securityChecks.length} security verification(s) but no vp/policy/*.rego gate. Consider adding a policy gate for sensitive behavior.`,
    );
  }

  // Heuristic 7: decisions present but unlinked to any vp file
  for (const d of decisions) {
    if (!d.impacts || d.impacts.length === 0) {
      add(
        "warn",
        "critique.decision_unlinked",
        relPath(cwd, d.__file),
        `Decision "${d.id}" has no impacts. Link it to the verification(s) it should enforce.`,
      );
    }
  }

  // Score: 100 minus penalties; baseline weights kept simple and transparent
  const errors = findings.filter(f => f.level === "error").length;
  const warnings = findings.filter(f => f.level === "warn").length;
  const infos = findings.filter(f => f.level === "info").length;
  let score = 100;
  score -= 10 * errors;
  score -= 4 * warnings;
  score -= 1 * infos;
  if (score < 0) score = 0;

  const linkageRatio = checks.length === 0 ? 0 : linkedFiles / checks.length;
  // Bonus for high decision linkage
  if (linkageRatio >= 0.8) score = Math.min(100, score + 5);

  const level = score >= 85 ? "strong"
    : score >= 70 ? "ok"
    : score >= 50 ? "weak"
    : "fragile";

  return {
    ok: errors === 0 && score >= 70,
    summary: {
      score,
      level,
      checks: checks.length,
      negative_checks: negativeChecks.length,
      decision_linked_files: linkedFiles,
      decision_linkage_ratio: Number(linkageRatio.toFixed(2)),
      decisions_total: decisions.length,
      errors,
      warnings,
      infos,
    },
    findings,
  };
}

function formatHuman(result) {
  const lines = [];
  const score = result.summary.score;
  const tag = score >= 85 ? green(`${score}/100 (strong)`)
    : score >= 70 ? green(`${score}/100 (ok)`)
    : score >= 50 ? yellow(`${score}/100 (weak)`)
    : red(`${score}/100 (fragile)`);
  lines.push(bold("Verification Pack Critique"));
  lines.push(`  Score:                ${tag}`);
  lines.push(`  Checks:               ${result.summary.checks}`);
  lines.push(`  Negative-case checks: ${result.summary.negative_checks}`);
  lines.push(`  Decision-linked:      ${result.summary.decision_linked_files}/${result.summary.checks} (${Math.round((result.summary.decision_linkage_ratio || 0) * 100)}%)`);
  lines.push(`  Decisions total:      ${result.summary.decisions_total}`);
  lines.push(`  Errors / warnings:    ${result.summary.errors} / ${result.summary.warnings}`);
  if (result.findings.length > 0) {
    lines.push("");
    lines.push(bold("Findings:"));
    for (const f of result.findings) {
      const tagL = f.level === "error" ? red("error") : f.level === "warn" ? yellow("warn") : dim("info");
      lines.push(`  [${tagL}] ${f.file} ${f.code}: ${f.message}`);
    }
  } else {
    lines.push("");
    lines.push(green("No critique findings — the pack passes all cognitive heuristics."));
  }
  if (result.message) {
    lines.push("");
    lines.push(yellow(result.message));
  }
  return lines.join("\n");
}

export function critique({ cwd, json = false }) {
  const result = runCritique(cwd);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatHuman(result));
  }
  return { exitCode: result.ok ? 0 : 1, result };
}
