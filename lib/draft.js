import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { buildMap } from "./map.js";
import { runLint } from "./lint.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { readConfig } from "./config.js";
import { defaultModelForProvider, generateWithProvider } from "./providers/index.js";

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "draft";
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function listWorkflowFiles(cwd) {
  const dir = path.join(cwd, ".github", "workflows");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(f => `.github/workflows/${f}`);
}

function collectSignals(cwd) {
  const pkg = readJsonIfExists(path.join(cwd, "package.json"));
  const deps = {
    ...pkg?.dependencies,
    ...pkg?.devDependencies,
    ...pkg?.peerDependencies,
    ...pkg?.optionalDependencies,
  };
  const depNames = Object.keys(deps || {});
  return {
    packageJson: pkg,
    depNames,
    workflows: listWorkflowFiles(cwd),
    hasPlaywright: depNames.includes("@playwright/test"),
    hasTsArch: depNames.includes("tsarch"),
    hasDepCruiser: depNames.includes("dependency-cruiser"),
    hasMadge: depNames.includes("madge"),
    hasBoundaries: depNames.includes("eslint-plugin-boundaries"),
    hasBrowserstack: depNames.some(name => name.includes("browserstack")),
    hasSauce: depNames.some(name => name.includes("sauce")),
    hasPercy: depNames.some(name => name.includes("percy")),
    hasDetox: depNames.includes("detox"),
    hasMaestro: depNames.some(name => name.includes("maestro")),
  };
}

function fileProposal(type, relPath, data, confidence, reason) {
  return { type, path: relPath, data, confidence, reason, source: "local" };
}

function uiProposals(map) {
  if (map.coverage.current.ui > 0) return [];
  return map.detected.ui_routes.slice(0, 3).map(route =>
    fileProposal(
      "ui",
      `vp/ui/${slugify(`route-${route}`)}.yml`,
      {
        id: slugify(`ui-route-${route}`),
        title: `Route ${route} is reachable`,
        severity: "warn",
        app: { kind: "web", base_url: "http://localhost:3000" },
        flow: [{ open: route }],
        assert: [{ url_matches: { regex: route === "/" ? "/" : route } }],
      },
      "medium",
      `Static analysis detected route ${route}.`,
    )
  );
}

function apiProposals(map) {
  if (map.coverage.current.api > 0) return [];
  const proposals = [];
  for (const endpoint of map.detected.api_endpoints.slice(0, 3)) {
    const match = endpoint.match(/^(GET|POST|PUT|PATCH|DELETE|FETCH)\s+(.+)$/);
    if (!match) continue;
    const method = match[1] === "FETCH" ? "GET" : match[1];
    const apiPath = match[2];
    proposals.push(fileProposal(
      "api",
      `vp/api/${slugify(`${method.toLowerCase()}-${apiPath}`)}.yml`,
      {
        id: slugify(`api-${method.toLowerCase()}-${apiPath}`),
        title: `${method} ${apiPath} responds successfully`,
        severity: "warn",
        app: { kind: "api", base_url: "http://localhost:3000" },
        request: { method, path: apiPath },
        assert: apiPath.includes("/api/")
          ? [{ status: 200 }, { header_matches: { name: "content-type", matches: "json" } }]
          : [{ status: 200 }],
      },
      apiPath.includes("/api/") ? "medium" : "low",
      `Static analysis detected endpoint ${method} ${apiPath}.`,
    ));
  }
  return proposals;
}

function behaviorProposals(map) {
  if (map.coverage.current.behavior > 0 || map.detected.ui_routes.length === 0) return [];
  const route = map.detected.ui_routes[0];
  return [
    fileProposal(
      "behavior",
      `vp/behavior/${slugify(`main-flow-${route}`)}.yml`,
      {
        id: slugify(`behavior-main-flow-${route}`),
        feature: "Main user flow",
        scenario: `User can reach ${route}`,
        severity: "warn",
        app: { kind: "web", base_url: "http://localhost:3000" },
        given: [{ open: route }],
        when: [],
        then: [{ url_matches: { regex: route === "/" ? "/" : route } }],
      },
      "medium",
      `A primary route ${route} was detected but no behavior scenario exists yet.`,
    ),
  ];
}

function dbProposals(map) {
  if (map.coverage.current.database > 0 || map.detected.db_tables.length === 0) return [];
  const table = map.detected.db_tables[0];
  return [
    fileProposal(
      "database",
      `vp/db/${slugify(`seed-${table}`)}.yml`,
      {
        id: slugify(`db-seed-${table}`),
        title: `${table} seed state is queryable`,
        severity: "warn",
        app: { kind: "db", engine: "sqlite", connection: "./test.db" },
        query: `SELECT * FROM ${table}`,
        assert: [{ row_count_gte: 0 }],
      },
      "low",
      `Table ${table} was detected, but engine/connection details remain ambiguous.`,
    ),
  ];
}

function securityProposals(map) {
  if (map.coverage.current.security > 0 || (map.detected.auth_signals + map.detected.security_signals) === 0) return [];
  const apiPath = map.detected.api_endpoints.find(endpoint => endpoint.startsWith("GET /api/"))?.replace(/^GET\s+/, "") || "/api/admin";
  return [
    fileProposal(
      "security",
      `vp/security/${slugify(`unauthenticated-${apiPath}`)}.yml`,
      {
        id: slugify(`security-unauthenticated-${apiPath}`),
        title: `${apiPath} rejects unauthenticated access`,
        severity: "warn",
        app: { kind: "security", base_url: "http://localhost:3000" },
        request: { method: "GET", path: apiPath },
        assert: [
          { status: 401 },
          { body_not_contains: "stack trace" },
        ],
      },
      "medium",
      `Auth/security signals were detected and ${apiPath} is a reasonable first rejection check.`,
    ),
  ];
}

function performanceProposals(map) {
  if (map.coverage.current.performance > 0) return [];
  const endpoint = map.detected.api_endpoints.find(e => e.startsWith("GET "))?.replace(/^GET\s+/, "") || map.detected.ui_routes[0] || "/";
  return [
    fileProposal(
      "performance",
      `vp/nfr/${slugify(`smoke-${endpoint}`)}.yml`,
      {
        id: slugify(`performance-smoke-${endpoint}`),
        title: `${endpoint} meets smoke performance budget`,
        severity: "warn",
        app: { kind: "nfr", base_url: "http://localhost:3000" },
        scenario: {
          endpoint,
          method: "GET",
          thresholds: {
            http_req_duration_p95: 500,
            http_req_failed: 0.05,
          },
          vus: 10,
          duration: "15s",
        },
      },
      "medium",
      `Performance smoke coverage is missing for ${endpoint}.`,
    ),
  ];
}

function technicalProposals(map, cwd) {
  if (map.coverage.current.technical > 0) return [];
  const signals = collectSignals(cwd);
  const proposals = [];

  if (signals.packageJson) {
    const depAssertions = [];
    if (signals.hasPlaywright) depAssertions.push({ dependency_present: { name: "@playwright/test", section: "devDependencies" } });
    if (signals.hasTsArch) depAssertions.push({ dependency_present: { name: "tsarch", section: "devDependencies" } });
    if (signals.hasDepCruiser) depAssertions.push({ dependency_present: { name: "dependency-cruiser", section: "devDependencies" } });
    if (signals.hasMadge) depAssertions.push({ dependency_present: { name: "madge", section: "devDependencies" } });
    if (signals.hasBoundaries) depAssertions.push({ dependency_present: { name: "eslint-plugin-boundaries", section: "devDependencies" } });

    if (depAssertions.length > 0) {
      proposals.push(fileProposal(
        "technical",
        "vp/technical/framework-stack.yml",
        {
          id: "technical-framework-stack",
          title: "Declared technical stack stays consistent",
          severity: "blocker",
          category: "framework",
          runner: { kind: "custom", framework: "custom" },
          app: { kind: "technical", root: "." },
          assert: [{ path_exists: { path: "package.json" } }, ...depAssertions],
        },
        "high",
        "package.json exposes concrete framework/tooling choices.",
      ));
    }
  }

  if (signals.workflows.length > 0) {
    const workflow = signals.workflows[0];
    proposals.push(fileProposal(
      "technical",
      "vp/technical/ci-workflow.yml",
      {
        id: "technical-ci-workflow",
        title: "Repository keeps the expected CI workflow",
        severity: "blocker",
        category: "ci",
        runner: { kind: "custom", framework: "custom" },
        app: { kind: "technical", root: "." },
        assert: [
          { path_exists: { path: workflow } },
          { github_action_uses: { workflow, action: "actions/checkout@v4" } },
        ],
      },
      "high",
      `Workflow ${workflow} exists and can be validated concretely.`,
    ));
  }

  if (signals.hasBrowserstack || signals.hasSauce || signals.hasPercy || signals.hasDetox || signals.hasMaestro) {
    const tooling = [];
    if (signals.hasBrowserstack) tooling.push({ dependency_present: { name: signals.depNames.find(n => n.includes("browserstack")), section: "all" } });
    if (signals.hasSauce) tooling.push({ dependency_present: { name: signals.depNames.find(n => n.includes("sauce")), section: "all" } });
    if (signals.hasPercy) tooling.push({ dependency_present: { name: signals.depNames.find(n => n.includes("percy")), section: "all" } });
    if (signals.hasDetox) tooling.push({ dependency_present: { name: "detox", section: "all" } });
    if (signals.hasMaestro) tooling.push({ dependency_present: { name: signals.depNames.find(n => n.includes("maestro")), section: "all" } });
    proposals.push(fileProposal(
      "technical",
      "vp/technical/testing-tooling.yml",
      {
        id: "technical-testing-tooling",
        title: "Declared browser/mobile testing services remain configured",
        severity: "warn",
        category: "testing",
        runner: { kind: "custom", framework: "custom" },
        app: { kind: "technical", root: "." },
        assert: tooling,
      },
      "high",
      "Repository already declares browser/mobile testing tooling.",
    ));
  }

  return proposals;
}

export function buildDraft(cwd) {
  const map = buildMap(cwd);
  const lint = runLint(cwd);
  const proposals = [
    ...uiProposals(map),
    ...behaviorProposals(map),
    ...apiProposals(map),
    ...dbProposals(map),
    ...performanceProposals(map),
    ...securityProposals(map),
    ...technicalProposals(map, cwd),
  ];

  const ambiguities = map.ambiguities || [];
  return {
    map,
    lint,
    proposals,
    summary: {
      current_errors: lint.summary.errors,
      current_warnings: lint.summary.warnings,
      proposed_files: proposals.length,
      high_confidence: proposals.filter(p => p.confidence === "high").length,
      medium_confidence: proposals.filter(p => p.confidence === "medium").length,
      low_confidence: proposals.filter(p => p.confidence === "low").length,
    },
    ambiguities,
  };
}

const AiDraftSchema = z.object({
  summary: z.string().optional(),
  gaps: z.array(z.string()).optional(),
  ambiguities: z.array(z.string()).optional(),
  proposals: z.array(z.object({
    type: z.enum(["ui", "behavior", "api", "database", "performance", "security", "technical"]),
    path: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    reason: z.string(),
    data: z.record(z.unknown()),
  }).strict()).optional(),
}).strict();

function extractJsonBlock(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export function resolveDraftOptions(cwd, overrides = {}) {
  const config = readConfig(cwd);
  const provider = overrides.provider || process.env.SHIPFLOW_DRAFT_PROVIDER || config.draft?.provider || "local";
  const model = overrides.model || process.env.SHIPFLOW_DRAFT_MODEL || config.draft?.model || defaultModelForProvider(provider);
  const providerOptions = provider === "command"
    ? { command: config.draft?.command || null }
    : {};
  return { config, provider, model, providerOptions };
}

export function buildDraftPrompt(result) {
  const lines = [];
  lines.push("You are refining a ShipFlow verification drafting workflow.");
  lines.push("Use the local repo map, current lint state, and starter proposals.");
  lines.push("Return ONLY JSON matching this shape:");
  lines.push(`{"summary":"...", "gaps":["..."], "ambiguities":["..."], "proposals":[{"type":"ui|behavior|api|database|performance|security|technical","path":"vp/...","confidence":"high|medium|low","reason":"...","data":{}}]}`);
  lines.push("");
  lines.push("Constraints:");
  lines.push("- Prefer precise, executable ShipFlow YAML data.");
  lines.push("- Proposals must be focused and automatable.");
  lines.push("- Keep paths stable and names clean.");
  lines.push("- Use full verification types; database not db, performance not nfr.");
  lines.push("- Do not explain outside JSON.");
  lines.push("");
  lines.push("Local map:");
  lines.push(JSON.stringify(result.map, null, 2));
  lines.push("");
  lines.push("Local lint:");
  lines.push(JSON.stringify(result.lint, null, 2));
  lines.push("");
  lines.push("Local starter proposals:");
  lines.push(JSON.stringify(result.proposals, null, 2));
  return lines.join("\n");
}

export function parseAiDraftResponse(text) {
  const raw = extractJsonBlock(text);
  return AiDraftSchema.parse(JSON.parse(raw));
}

function normalizeAiProposal(proposal) {
  return {
    ...proposal,
    source: "ai",
  };
}

function mergeDraftResults(localResult, aiResult, options) {
  const merged = new Map();
  for (const proposal of localResult.proposals) {
    merged.set(proposal.path, proposal);
  }
  for (const proposal of aiResult.proposals || []) {
    merged.set(proposal.path, normalizeAiProposal(proposal));
  }

  return {
    ...localResult,
    proposals: [...merged.values()],
    ambiguities: [...new Set([...(localResult.ambiguities || []), ...(aiResult.ambiguities || [])])],
    ai: {
      enabled: true,
      provider: options.provider,
      model: options.model || null,
      summary: aiResult.summary || null,
      gaps: aiResult.gaps || [],
    },
    summary: {
      ...localResult.summary,
      proposed_files: merged.size,
      high_confidence: [...merged.values()].filter(p => p.confidence === "high").length,
      medium_confidence: [...merged.values()].filter(p => p.confidence === "medium").length,
      low_confidence: [...merged.values()].filter(p => p.confidence === "low").length,
    },
  };
}

async function maybeEnhanceDraft(cwd, localResult, options, generateText = generateWithProvider) {
  if (options.provider === "local") {
    return {
      ...localResult,
      ai: {
        enabled: false,
        provider: "local",
        model: null,
        summary: null,
        gaps: [],
      },
    };
  }

  const prompt = buildDraftPrompt(localResult);
  const text = await generateText({
    provider: options.provider,
    model: options.model,
    maxTokens: 16384,
    prompt,
    options: options.providerOptions,
  });
  const aiResult = parseAiDraftResponse(text);
  return mergeDraftResults(localResult, aiResult, options);
}

function writeProposals(cwd, proposals) {
  const created = [];
  for (const proposal of proposals) {
    const full = path.join(cwd, proposal.path);
    if (fs.existsSync(full)) continue;
    mkdirp(path.dirname(full));
    writeFile(full, yaml.dump(proposal.data, { noRefs: true, lineWidth: 120 }));
    created.push(proposal.path);
  }
  return created;
}

function formatHuman(result, writeMode) {
  const lines = [];
  lines.push("ShipFlow Draft");
  lines.push("");
  lines.push("What the system understood:");
  lines.push(`  UI routes: ${result.map.detected.ui_routes.slice(0, 5).join(", ") || "(none)"}`);
  lines.push(`  API endpoints: ${result.map.detected.api_endpoints.slice(0, 5).join(", ") || "(none)"}`);
  lines.push(`  Database tables: ${result.map.detected.db_tables.slice(0, 5).join(", ") || "(none)"}`);
  lines.push(`  Technical files: ${result.map.detected.technical_files.slice(0, 5).join(", ") || "(none)"}`);
  lines.push("");
  lines.push("Coverage gaps:");
  if (result.map.coverage.gaps.length === 0) lines.push("  (none detected)");
  else for (const gap of result.map.coverage.gaps) lines.push(`  - ${gap}`);
  lines.push("");
  lines.push("Ambiguities:");
  if (result.ambiguities.length === 0) lines.push("  (none detected)");
  else for (const item of result.ambiguities) lines.push(`  - ${item}`);
  lines.push("");
  lines.push("Proposed verification starters:");
  if (result.proposals.length === 0) lines.push("  (no proposal)");
  else {
    for (const proposal of result.proposals) {
      lines.push(`  - [${proposal.confidence}] ${proposal.path} — ${proposal.reason}${proposal.source === "ai" ? " (AI)" : ""}`);
    }
  }
  if (result.ai?.enabled) {
    lines.push("");
    lines.push(`AI refinement: ${result.ai.provider}${result.ai.model ? ` / ${result.ai.model}` : ""}`);
    if (result.ai.summary) lines.push(`  ${result.ai.summary}`);
  }
  if (writeMode) {
    lines.push("");
    lines.push(`Written files: ${result.written.length ? result.written.join(", ") : "(none)"}`);
  } else {
    lines.push("");
    lines.push("Run `shipflow draft --write` to write starter files into `vp/`.");
  }
  return lines.join("\n");
}

export async function draft({ cwd, json = false, write = false, provider, model, ai = false, generateText }) {
  const local = buildDraft(cwd);
  const draftOptions = resolveDraftOptions(cwd, { provider, model });
  const effectiveOptions = {
    ...draftOptions,
    provider: ai && draftOptions.provider === "local" ? "anthropic" : draftOptions.provider,
  };
  const result = ai || effectiveOptions.provider !== "local"
    ? await maybeEnhanceDraft(cwd, local, effectiveOptions, generateText)
    : await maybeEnhanceDraft(cwd, local, draftOptions, generateText);
  const written = write ? writeProposals(cwd, result.proposals.filter(p => p.confidence !== "low")) : [];
  const full = { ...result, written };
  if (json) {
    console.log(JSON.stringify(full, null, 2));
  } else {
    console.log(formatHuman(full, write));
  }
  return { exitCode: 0, result: full };
}
