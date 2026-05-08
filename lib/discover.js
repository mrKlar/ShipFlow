import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DiscoverySession, DiscoveryProposal } from "./schema/discovery.zod.js";
import { mkdirp, writeFile } from "./util/fs.js";
import { bold, dim, green, yellow, red } from "./util/color.js";
import { parseFlags, relPath } from "./util/cli.js";
import { timestampStamp } from "./util/id.js";
import { buildMap } from "./map.js";

const DISCOVERY_DIR = path.join(".shipflow", "discovered");

export function discoveryDir(cwd) {
  return path.join(cwd, DISCOVERY_DIR);
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
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) {
      issues.push({
        file: item.__file,
        code: "discovery.duplicate_id",
        message: `Duplicate discovery session id: ${item.id}`,
      });
    }
    ids.add(item.id);
  }
  return { items, issues };
}

// Materializes a DiscoveryProposal into a vp scaffold file at the
// proposal's suggested_path. Each scaffold is intentionally a minimal,
// schema-valid skeleton with explicit TODO markers — critique will
// flag them via critique.placeholder_present, preventing the user
// from approving a pack before doing the actual brownfield capture.
export function scaffoldFromProposal(proposal) {
  const target = String(proposal.target || "");
  switch (proposal.kind) {
    case "ui_route":
      return [
        `id: regression-${slugifyRoute(target)}`,
        `title: "TODO — describe the rendering contract for ${target}"`,
        "severity: blocker",
        "app:",
        "  kind: web",
        "  base_url: http://localhost:3000",
        "flow:",
        `  - open: ${target || "/"}`,
        "assert:",
        "  - text_equals:",
        "      testid: TODO-fill-in",
        "      equals: \"TODO observed text on this route\"",
      ].join("\n") + "\n";

    case "api_endpoint": {
      const match = target.match(/^([A-Z]+)\s+(.+)$/);
      const method = match ? match[1] : "GET";
      const route = match ? match[2] : target;
      return [
        `id: regression-${method.toLowerCase()}-${slugifyRoute(route)}`,
        `title: "TODO — describe the contract for ${method} ${route}"`,
        "severity: blocker",
        "app:",
        "  kind: api",
        "  base_url: http://localhost:3000",
        "request:",
        `  method: ${method}`,
        `  path: ${route}`,
        "assert:",
        "  - status: 200",
        "  - header_matches: { name: content-type, matches: json }",
        "  - json_type: { path: \"$\", type: object }  # TODO: refine to the real shape",
      ].join("\n") + "\n";
    }

    case "graphql_endpoint":
      return [
        `id: regression-graphql-${slugifyRoute(target)}`,
        `title: "TODO — describe a current GraphQL contract on ${target}"`,
        "severity: blocker",
        "app:",
        "  kind: api",
        "  base_url: http://localhost:3000",
        "request:",
        "  method: POST",
        `  path: ${target || "/graphql"}`,
        "  json_body: { query: \"{ __typename }\" }  # TODO: replace with a real query / mutation",
        "assert:",
        "  - status: 200",
        "  - json_type: { path: \"$.data\", type: object }",
      ].join("\n") + "\n";

    case "db_table":
      return [
        `id: regression-${slugifyRoute(target)}`,
        `title: "TODO — describe the ${target} persistence contract"`,
        "severity: blocker",
        "app:",
        "  kind: db",
        "  engine: sqlite  # TODO: change to postgres / mysql if applicable",
        "  connection: ./data/app.db  # TODO: real connection",
        `query: \"SELECT 1 FROM ${target} LIMIT 1\"`,
        "assert:",
        "  - row_count_at_least: 0  # TODO: tighten to the real invariant",
      ].join("\n") + "\n";

    case "auth_surface":
      return [
        "id: regression-auth-boundary",
        "title: \"TODO — capture the current authentication boundary\"",
        "severity: blocker",
        "app:",
        "  kind: security",
        "  base_url: http://localhost:3000",
        "request:",
        "  method: GET",
        "  path: /api/admin  # TODO: real protected path",
        "assert:",
        "  - status: 401",
        "  - body_not_contains: \"stack trace\"",
      ].join("\n") + "\n";

    case "security_surface":
      return [
        "id: regression-security-headers",
        "title: \"TODO — capture the current security-header posture\"",
        "severity: blocker",
        "app:",
        "  kind: security",
        "  base_url: http://localhost:3000",
        "request:",
        "  method: GET",
        "  path: /  # TODO: representative entry path",
        "assert:",
        "  - status: 200",
        "  - header_present: { name: \"X-Content-Type-Options\" }  # TODO: full header policy",
      ].join("\n") + "\n";

    case "technical_surface":
      return [
        `id: regression-technical-${slugifyRoute(path.basename(String(target)).replace(/\.[^.]+$/, "")) || "ci"}`,
        `title: "TODO — capture the technical contract carried by ${target}"`,
        "severity: blocker",
        "category: ci  # TODO: choose ci | dependencies | architecture | runtime",
        "runner:",
        "  kind: custom",
        "  framework: custom",
        "app:",
        "  kind: technical",
        "  root: .",
        "assert:",
        `  - path_exists: { path: ${JSON.stringify(target)} }`,
      ].join("\n") + "\n";

    default:
      throw new Error(`Unknown proposal kind: ${proposal.kind}`);
  }
}

export function promoteProposal(cwd, sessionId, { kind, target, index } = {}) {
  const session = findDiscoverySession(cwd, sessionId);
  if (!session) throw new Error(`Discovery session not found: ${sessionId}`);
  const proposals = session.proposals || [];
  if (proposals.length === 0) throw new Error(`Discovery session ${sessionId} has no proposals to promote`);

  let proposal;
  if (Number.isFinite(index)) {
    proposal = proposals[index];
    if (!proposal) throw new Error(`Index out of range: ${index} (session has ${proposals.length} proposal(s))`);
  } else if (kind && target) {
    proposal = proposals.find(p => p.kind === kind && p.target === target);
    if (!proposal) throw new Error(`No proposal matching kind=${kind} target=${target}`);
  } else if (kind) {
    const matches = proposals.filter(p => p.kind === kind);
    if (matches.length === 0) throw new Error(`No proposal of kind ${kind}`);
    if (matches.length > 1) {
      throw new Error(`Multiple proposals of kind ${kind} — pass --target=<target> or --index=<n> to disambiguate`);
    }
    proposal = matches[0];
  } else {
    throw new Error("Provide --kind=<kind> [--target=<target>] OR --index=<n> to select a proposal");
  }

  const outPath = path.join(cwd, proposal.suggested_path);
  if (fs.existsSync(outPath)) {
    throw new Error(`vp file already exists: ${proposal.suggested_path} (delete it first or pick another proposal)`);
  }
  const body = scaffoldFromProposal(proposal);
  mkdirp(path.dirname(outPath));
  writeFile(outPath, body);
  return { file: outPath, proposal, vpPath: proposal.suggested_path };
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

  if (sub === "promote") {
    const id = rest.find(a => !a.startsWith("--"));
    if (!id) {
      console.error("usage: shipflow discover promote <session-id> [--kind=<kind>] [--target=<target>] [--index=<n>]");
      return { exitCode: 2 };
    }
    const flagMap = parseFlags(rest);
    const indexNum = flagMap.index !== undefined ? Number(flagMap.index) : NaN;
    try {
      const { file, proposal, vpPath } = promoteProposal(cwd, id, {
        kind: flagMap.kind,
        target: flagMap.target,
        index: Number.isFinite(indexNum) ? indexNum : undefined,
      });
      if (json) {
        process.stdout.write(JSON.stringify({
          promoted: relPath(cwd, file),
          vp_path: vpPath,
          proposal,
        }, null, 2) + "\n");
      } else {
        console.log(green(`Scaffolded ${vpPath}`));
        console.log(dim(`  source: ${proposal.kind} target=${proposal.target}`));
        console.log(yellow(`  TODOs in the file — fill in real assertions before approving the pack.`));
      }
      return { exitCode: 0 };
    } catch (err) {
      console.error(String(err?.message || err));
      return { exitCode: 1 };
    }
  }

  console.error(`Unknown discover subcommand: ${sub}`);
  console.error("Available: (default scan), list, show, promote");
  return { exitCode: 2 };
}
