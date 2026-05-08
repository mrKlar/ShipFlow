import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  buildProposals,
  runDiscovery,
  loadDiscoverySessions,
  findDiscoverySession,
  discoverCli,
  discoveryDir,
  scaffoldFromProposal,
  promoteProposal,
} from "../../lib/discover.js";
import { withTmpDir as tmpDir } from "../util/tmp.js";
import { captureStdio } from "../util/stdio.js";

const withTmpDir = (fn) => tmpDir("shipflow-discover", fn);

describe("discover", () => {
  it("buildProposals from a synthesized map turns surfaces into regression suggestions", () => {
    const fakeMap = {
      project: { app_archetype: "node-api" },
      detected: {
        ui_routes: ["/login", "/dashboard"],
        api_endpoints: ["GET /api/users", "POST /api/users"],
        db_tables: ["users"],
        auth_signals: 5,
        security_signals: 0,
        technical_files: [".github/workflows/ci.yml"],
        protocols: { graphql: { endpoints: [] }, rest: { detected: true } },
      },
    };
    withTmpDir(tmp => {
      const proposals = buildProposals(tmp, fakeMap);
      const kinds = new Set(proposals.map(p => p.kind));
      assert.ok(kinds.has("ui_route"));
      assert.ok(kinds.has("api_endpoint"));
      assert.ok(kinds.has("db_table"));
      assert.ok(kinds.has("auth_surface"));
      assert.ok(kinds.has("technical_surface"));

      const apiPaths = proposals.filter(p => p.kind === "api_endpoint").map(p => p.suggested_path);
      for (const p of apiPaths) assert.match(p, /^vp\/api\/regression-/);
    });
  });

  it("buildProposals filters out surfaces already covered by an existing vp file", () => {
    const fakeMap = {
      detected: {
        ui_routes: ["/login"],
        api_endpoints: [],
        db_tables: [],
        auth_signals: 0,
        security_signals: 0,
        technical_files: [],
        protocols: { graphql: { endpoints: [] }, rest: {} },
      },
    };
    withTmpDir(tmp => {
      const proposals1 = buildProposals(tmp, fakeMap);
      assert.equal(proposals1.length, 1);

      // Now create the suggested vp file
      const target = path.join(tmp, proposals1[0].suggested_path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "id: existing\n");

      const proposals2 = buildProposals(tmp, fakeMap);
      assert.equal(proposals2.length, 0, "expected the proposal to be filtered out once the vp file exists");
    });
  });

  it("runDiscovery writes a session json under .shipflow/discovered/", () => {
    withTmpDir(tmp => {
      // Tiny fake source so buildMap returns something
      const srcDir = path.join(tmp, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "server.js"),
        "app.get('/api/users', (req, res) => res.json([]));\nrouter.post('/api/users', (req, res) => res.json({}));\n");

      const { session, file } = runDiscovery(tmp);
      assert.ok(fs.existsSync(file));
      assert.match(session.id, /^discover-/);
      const { items } = loadDiscoverySessions(tmp);
      assert.equal(items.length, 1);
      assert.equal(findDiscoverySession(tmp, session.id)?.id, session.id);
    });
  });

  it("CLI: scan with empty repo prints helpful note and writes empty session", () => {
    withTmpDir(tmp => {
      const { result, stdout } = captureStdio(() => discoverCli({ cwd: tmp, args: [] }));
      assert.equal(result.exitCode, 0);
      assert.match(stdout, /Discovery session: discover-/);
      const dir = discoveryDir(tmp);
      assert.ok(fs.existsSync(dir));
      assert.equal(fs.readdirSync(dir).length, 1);
    });
  });

  it("CLI: list returns empty hint when no sessions", () => {
    withTmpDir(tmp => {
      const { result, stdout } = captureStdio(() => discoverCli({ cwd: tmp, args: ["list"] }));
      assert.equal(result.exitCode, 0);
      assert.match(stdout, /No discovery sessions/);
    });
  });

  it("CLI: show returns 1 when missing", () => {
    withTmpDir(tmp => {
      const { result } = captureStdio(() => discoverCli({ cwd: tmp, args: ["show", "missing"] }));
      assert.equal(result.exitCode, 1);
    });
  });

  it("loadDiscoverySessions flags duplicate ids", () => {
    withTmpDir(tmp => {
      const dir = discoveryDir(tmp);
      fs.mkdirSync(dir, { recursive: true });
      const body = (id) => JSON.stringify({
        id,
        created_at: "2026-05-07T00:00:00.000Z",
        proposals: [],
        by_kind: {},
      }) + "\n";
      fs.writeFileSync(path.join(dir, "first.json"), body("dup"));
      fs.writeFileSync(path.join(dir, "second.json"), body("dup"));
      const { issues } = loadDiscoverySessions(tmp);
      assert.ok(issues.some(i => i.code === "discovery.duplicate_id"));
    });
  });

  it("scaffoldFromProposal generates a parse-able vp body for each kind", () => {
    const cases = [
      { kind: "ui_route", target: "/login" },
      { kind: "api_endpoint", target: "GET /api/users" },
      { kind: "graphql_endpoint", target: "/graphql" },
      { kind: "db_table", target: "users" },
      { kind: "auth_surface", target: "(detected auth signals)" },
      { kind: "security_surface", target: "(detected security signals)" },
      { kind: "technical_surface", target: ".github/workflows/ci.yml" },
    ];
    for (const c of cases) {
      const body = scaffoldFromProposal({ ...c, suggested_path: "vp/x.yml", title: "T", rationale: "R" });
      // Each scaffold is YAML-loadable
      const parsed = yaml.load(body);
      assert.ok(parsed.id, `${c.kind} scaffold has an id`);
      assert.ok(parsed.title, `${c.kind} scaffold has a title`);
      assert.equal(parsed.severity, "blocker");
      // Each scaffold contains explicit TODOs so critique flags it
      // before approval (placeholder_present heuristic)
      assert.match(body, /TODO/, `${c.kind} scaffold must contain a TODO marker`);
    }
  });

  it("promoteProposal writes the suggested vp file and records its provenance", () => {
    withTmpDir(tmp => {
      // Synthesize a discovery session with one ui_route proposal
      const dir = discoveryDir(tmp);
      fs.mkdirSync(dir, { recursive: true });
      const session = {
        id: "discover-test-2026-05-08",
        created_at: "2026-05-08T00:00:00.000Z",
        proposals: [{
          kind: "ui_route",
          target: "/login",
          title: "Renders existing route /login",
          suggested_path: "vp/ui/regression-login.yml",
          rationale: "Detected existing route",
          evidence: [],
        }],
        by_kind: { ui_route: 1 },
      };
      fs.writeFileSync(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));

      const result = promoteProposal(tmp, session.id, { kind: "ui_route" });
      assert.equal(result.vpPath, "vp/ui/regression-login.yml");
      assert.ok(fs.existsSync(result.file));
      const body = fs.readFileSync(result.file, "utf-8");
      assert.match(body, /id: regression-login/);
      assert.match(body, /TODO/);
    });
  });

  it("promoteProposal refuses to overwrite an existing vp file", () => {
    withTmpDir(tmp => {
      const dir = discoveryDir(tmp);
      fs.mkdirSync(dir, { recursive: true });
      const session = {
        id: "discover-clash-2026-05-08",
        created_at: "2026-05-08T00:00:00.000Z",
        proposals: [{
          kind: "ui_route",
          target: "/home",
          title: "T",
          suggested_path: "vp/ui/regression-home.yml",
          rationale: "R",
          evidence: [],
        }],
      };
      fs.writeFileSync(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));

      // Pre-create the vp file
      fs.mkdirSync(path.join(tmp, "vp", "ui"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "vp", "ui", "regression-home.yml"), "id: existing\n");

      assert.throws(
        () => promoteProposal(tmp, session.id, { kind: "ui_route" }),
        /already exists/,
      );
    });
  });

  it("CLI: promote with no selector returns 2", () => {
    withTmpDir(tmp => {
      const dir = discoveryDir(tmp);
      fs.mkdirSync(dir, { recursive: true });
      const session = {
        id: "discover-x-2026-05-08",
        created_at: "2026-05-08T00:00:00.000Z",
        proposals: [
          { kind: "ui_route", target: "/a", title: "A", suggested_path: "vp/ui/a.yml", rationale: "R", evidence: [] },
          { kind: "ui_route", target: "/b", title: "B", suggested_path: "vp/ui/b.yml", rationale: "R", evidence: [] },
        ],
      };
      fs.writeFileSync(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));

      // Two proposals of same kind, no target/index -> should fail with helpful error
      const { result, stderr } = captureStdio(() => discoverCli({
        cwd: tmp,
        args: ["promote", session.id, "--kind=ui_route"],
      }));
      assert.equal(result.exitCode, 1);
      assert.match(stderr, /pass --target/);
    });
  });

  it("CLI: unknown subcommand returns 2", () => {
    withTmpDir(tmp => {
      const { result } = captureStdio(() => discoverCli({ cwd: tmp, args: ["whatever"] }));
      assert.equal(result.exitCode, 2);
    });
  });
});
