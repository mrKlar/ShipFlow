import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { DiscoverySession, DiscoveryProposal } from "./schema/discovery.zod.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { bold, dim, green, yellow, red } from "./util/color.js";
import { buildMap } from "./map.js";

const DISCOVERY_DIR = path.join(".shipflow", "discovered");

export function discoveryDir(cwd) {
  return path.join(cwd, DISCOVERY_DIR);
}

function timestampStamp(date = new Date()) {
  const iso = date.toISOString();
  return iso.replace(/[:T]/g, "-").replace(/\..+$/, "Z");
}

function slugifyRoute(route) {
  if (route === "/" || !route) return "home";
  return String(route)
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "route";
}

function slugifyApi(method, route) {
  const slug = slugifyRoute(route);
  return `${(method || "any").toLowerCase()}-${slug}`;
}

function uniqueByKey(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function vpFileExists(cwd, suggestedPath) {
  return fs.existsSync(path.join(cwd, suggestedPath));
}

export function buildProposals(cwd, mapResult) {
  const proposals = [];

  // UI routes -> ui regression VP
  const uiRoutes = uniqueByKey(mapResult.detected?.ui_routes || [], r => String(r));
  for (const route of uiRoutes) {
    const slug = slugifyRoute(route);
    const suggested = `vp/ui/regression-${slug}.yml`;
    proposals.push({
      kind: "ui_route",
      target: String(route),
      title: `Renders existing route ${route}`,
      suggested_path: suggested,
      rationale: `Existing UI route detected by static analysis. Capture current rendering as a regression contract before refactors change it.`,
      evidence: [],
    });
  }

  // API endpoints (format: "METHOD /path")
  const apiEndpoints = uniqueByKey(mapResult.detected?.api_endpoints || [], e => String(e));
  for (const endpoint of apiEndpoints) {
    const match = String(endpoint).match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|ANY|FETCH)\s+(.+)$/);
    const method = match ? match[1] : "ANY";
    const route = match ? match[2] : String(endpoint);
    const slug = slugifyApi(method, route);
    const suggested = `vp/api/regression-${slug}.yml`;
    proposals.push({
      kind: "api_endpoint",
      target: `${method} ${route}`,
      title: `Existing API contract for ${method} ${route}`,
      suggested_path: suggested,
      rationale: `Existing API handler detected by static analysis. Capture current request/response shape as a regression contract.`,
      evidence: [],
    });
  }

  // GraphQL endpoints (under detected.protocols.graphql.endpoints)
  const graphqlEndpoints = uniqueByKey(
    mapResult.detected?.protocols?.graphql?.endpoints || [],
    e => String(e),
  );
  for (const route of graphqlEndpoints) {
    const slug = slugifyRoute(String(route));
    proposals.push({
      kind: "graphql_endpoint",
      target: String(route),
      title: `Existing GraphQL endpoint ${route}`,
      suggested_path: `vp/api/regression-graphql-${slug}.yml`,
      rationale: `GraphQL endpoint detected by static analysis. Capture an existing query/mutation contract before changing the schema.`,
      evidence: [],
    });
  }

  // DB tables
  const dbTables = uniqueByKey(mapResult.detected?.db_tables || [], t => String(t));
  for (const tableName of dbTables) {
    const slug = slugifyRoute(String(tableName));
    proposals.push({
      kind: "db_table",
      target: String(tableName),
      title: `Persistence shape of ${tableName}`,
      suggested_path: `vp/db/regression-${slug}.yml`,
      rationale: `Existing table reference detected. Capture row shape, key invariants, and reasonable retention as a regression contract.`,
      evidence: [],
    });
  }

  // Security surfaces (signals counted; if any, propose at least a baseline auth + headers check)
  const authSignals = mapResult.detected?.auth_signals || 0;
  const securitySignals = mapResult.detected?.security_signals || 0;
  if (authSignals > 0) {
    proposals.push({
      kind: "auth_surface",
      target: "(detected auth signals)",
      title: "Existing authentication boundary",
      suggested_path: "vp/security/regression-auth.yml",
      rationale: `Repository contains ${authSignals} auth-related references. Capture current 401/403/redirect semantics as a regression contract before changing them.`,
      evidence: [],
    });
  }
  if (securitySignals > 0) {
    proposals.push({
      kind: "security_surface",
      target: "(detected security signals)",
      title: "Existing security headers / rate-limit posture",
      suggested_path: "vp/security/regression-headers.yml",
      rationale: `Repository contains ${securitySignals} security-related references. Lock current header / rate-limit posture as a regression contract.`,
      evidence: [],
    });
  }

  // Technical surfaces
  const technicalFiles = mapResult.detected?.technical_files || [];
  for (const file of technicalFiles.slice(0, 20)) {
    const slug = slugifyRoute(path.basename(file).replace(/\.[^.]+$/, ""));
    proposals.push({
      kind: "technical_surface",
      target: file,
      title: `Existing technical contract: ${file}`,
      suggested_path: `vp/technical/regression-${slug}.yml`,
      rationale: `Detected technical artifact (CI, build, deploy, infra). Capture as a technical regression so refactors do not silently change it.`,
      evidence: [file],
    });
  }

  // Filter: if a suggested_path already exists in vp/, drop the proposal so we never re-propose covered surfaces.
  return proposals.filter(p => {
    try {
      DiscoveryProposal.parse(p);
    } catch {
      return false;
    }
    return !vpFileExists(cwd, p.suggested_path);
  });
}

export function listDiscoveryFiles(cwd) {
  const dir = discoveryDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => path.join(dir, f))
    .sort();
}

export function loadDiscoverySessions(cwd) {
  const issues = [];
  const items = [];
  for (const file of listDiscoveryFiles(cwd)) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err) {
      issues.push({ file, code: "json.parse_error", message: String(err?.message || err) });
      continue;
    }
    try {
      const parsed = DiscoverySession.parse(raw);
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

export function findDiscoverySession(cwd, id) {
  const { items } = loadDiscoverySessions(cwd);
  return items.find(s => s.id === id) || null;
}

export function runDiscovery(cwd, { now = new Date() } = {}) {
  const mapResult = buildMap(cwd, "");
  const proposals = buildProposals(cwd, mapResult);
  const byKind = {};
  for (const p of proposals) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  const id = `discover-${timestampStamp(now)}`;
  const session = DiscoverySession.parse({
    id,
    created_at: now.toISOString(),
    app_archetype: mapResult.project?.app_archetype || null,
    proposals,
    by_kind: byKind,
  });
  const dir = discoveryDir(cwd);
  mkdirp(dir);
  const file = path.join(dir, `${id}.json`);
  writeFile(file, JSON.stringify(session, null, 2) + "\n");
  return { session, file, mapResult };
}

function relPath(cwd, file) {
  return path.relative(cwd, file).replaceAll("\\", "/");
}

export function discoverCli({ cwd, args, json = false }) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "scan" || sub === "new") {
    const { session, file, mapResult } = runDiscovery(cwd);
    if (json) {
      process.stdout.write(JSON.stringify({
        session: { ...session, __file: relPath(cwd, file) },
        app_archetype: mapResult.project?.app_archetype || null,
      }, null, 2) + "\n");
      return { exitCode: 0 };
    }
    console.log(green(`Discovery session: ${session.id}`));
    console.log(dim(`  ${relPath(cwd, file)}`));
    if (session.app_archetype) console.log(dim(`  app archetype: ${session.app_archetype}`));
    if (session.proposals.length === 0) {
      console.log(yellow("  No new regression proposals — either the repo is empty or every detected surface is already covered by vp/."));
      return { exitCode: 0 };
    }
    console.log("");
    console.log(bold(`Regression proposals (${session.proposals.length})`));
    const groups = new Map();
    for (const p of session.proposals) {
      const list = groups.get(p.kind) || [];
      list.push(p);
      groups.set(p.kind, list);
    }
    for (const [kind, list] of groups) {
      console.log("");
      console.log(bold(`  ${kind} (${list.length})`));
      for (const p of list) {
        console.log(`    • ${p.target}`);
        console.log(dim(`      → ${p.suggested_path}`));
        console.log(dim(`      ${p.rationale}`));
      }
    }
    console.log("");
    console.log(dim("Promote a proposal with: shipflow discover promote " + session.id + " --kind=<kind> --target=<target>"));
    console.log(dim("Or run shipflow draft and reference --source-ref=" + session.id));
    return { exitCode: 0 };
  }

  if (sub === "list") {
    const { items, issues } = loadDiscoverySessions(cwd);
    if (json) {
      process.stdout.write(JSON.stringify({
        sessions: items.map(s => ({ ...s, __file: relPath(cwd, s.__file) })),
        issues: issues.map(i => ({ ...i, file: relPath(cwd, i.file) })),
      }, null, 2) + "\n");
      return { exitCode: issues.length ? 1 : 0 };
    }
    if (items.length === 0) {
      console.log(dim("No discovery sessions yet. Run `shipflow discover` to scan."));
      return { exitCode: 0 };
    }
    console.log(bold(`Discovery sessions (${items.length})`));
    for (const s of items) {
      const proposalCount = s.proposals?.length || 0;
      console.log(`  ${bold(s.id)}  ${dim(s.created_at)}`);
      console.log(dim(`    ${proposalCount} proposal(s)`));
    }
    return { exitCode: 0 };
  }

  if (sub === "show") {
    const id = rest.find(a => !a.startsWith("--"));
    if (!id) {
      console.error("usage: shipflow discover show <id>");
      return { exitCode: 2 };
    }
    const session = findDiscoverySession(cwd, id);
    if (!session) {
      console.error(`Discovery session not found: ${id}`);
      return { exitCode: 1 };
    }
    if (json) {
      process.stdout.write(JSON.stringify({ ...session, __file: relPath(cwd, session.__file) }, null, 2) + "\n");
      return { exitCode: 0 };
    }
    console.log(JSON.stringify(session, null, 2));
    return { exitCode: 0 };
  }

  console.error(`Unknown discover subcommand: ${sub}`);
  console.error("Available: (default scan), list, show");
  return { exitCode: 2 };
}
