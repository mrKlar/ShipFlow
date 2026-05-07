import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildProposals,
  runDiscovery,
  loadDiscoverySessions,
  findDiscoverySession,
  discoverCli,
  discoveryDir,
} from "../../lib/discover.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-discover-"));
  try {
    return fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function captureStdio(fn) {
  const out = [];
  const err = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const origLog = console.log;
  const origErrLog = console.error;
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  console.log = (...args) => { out.push(args.join(" ") + "\n"); };
  console.error = (...args) => { err.push(args.join(" ") + "\n"); };
  try {
    const result = fn();
    return { result, stdout: out.join(""), stderr: err.join("") };
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    console.log = origLog;
    console.error = origErrLog;
  }
}

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

  it("CLI: unknown subcommand returns 2", () => {
    withTmpDir(tmp => {
      const { result } = captureStdio(() => discoverCli({ cwd: tmp, args: ["whatever"] }));
      assert.equal(result.exitCode, 2);
    });
  });
});
