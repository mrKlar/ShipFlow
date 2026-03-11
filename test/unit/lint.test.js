import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runLint } from "../../lib/lint.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-lint-"));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function mkdirs(base) {
  for (const dir of ["ui/_fixtures", "behavior", "api", "db", "nfr", "security", "technical"]) {
    fs.mkdirSync(path.join(base, "vp", dir), { recursive: true });
  }
}

describe("runLint", () => {
  it("reports missing assertions and duplicate ids", () => {
    withTmpDir(tmpDir => {
      mkdirs(tmpDir);
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "login.yml"), `
id: duplicate-id
title: Login
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /login
assert: []
`);
      fs.writeFileSync(path.join(tmpDir, "vp", "api", "users.yml"), `
id: duplicate-id
title: Users
severity: blocker
app:
  kind: api
  base_url: http://localhost:3000
request:
  method: GET
  path: /api/users
assert:
  - json_count: { path: "$", count: 1 }
`);

      const result = runLint(tmpDir);
      assert.equal(result.ok, false);
      assert.ok(result.issues.some(i => i.code === "ui.missing_assert"));
      assert.ok(result.issues.some(i => i.code === "vp.duplicate_id"));
      assert.ok(result.issues.some(i => i.code === "api.missing_status"));
    });
  });

  it("warns on weak UI assertions and empty thresholds", () => {
    withTmpDir(tmpDir => {
      mkdirs(tmpDir);
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "profile.yml"), `
id: profile
title: Profile
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /profile
assert:
  - visible: { testid: avatar }
`);
      fs.writeFileSync(path.join(tmpDir, "vp", "nfr", "load.yml"), `
id: load
title: Load
severity: blocker
app:
  kind: nfr
  base_url: http://localhost:3000
scenario:
  endpoint: /
  thresholds: {}
  vus: 5
  duration: 5s
`);

      const result = runLint(tmpDir);
      assert.ok(result.issues.some(i => i.code === "ui.weak_asserts"));
      assert.ok(result.issues.some(i => i.code === "nfr.missing_thresholds"));
      assert.ok(result.issues.some(i => i.code === "nfr.short_duration"));
    });
  });

  it("accepts a focused security check", () => {
    withTmpDir(tmpDir => {
      mkdirs(tmpDir);
      fs.writeFileSync(path.join(tmpDir, "vp", "security", "authz.yml"), `
id: security-authz
title: Reject guest access
severity: blocker
category: authz
app:
  kind: security
  base_url: http://localhost:3000
request:
  method: GET
  path: /api/admin
assert:
  - status: 401
  - header_absent: { name: x-internal-token }
`);

      const result = runLint(tmpDir);
      assert.equal(result.ok, true);
      assert.equal(result.summary.errors, 0);
    });
  });

  it("warns when an architecture runner has no architecture assertion", () => {
    withTmpDir(tmpDir => {
      mkdirs(tmpDir);
      fs.writeFileSync(path.join(tmpDir, "vp", "technical", "architecture.yml"), `
id: architecture-rules
title: Architecture stays layered
severity: blocker
category: architecture
runner:
  kind: archtest
  framework: dependency-cruiser
app:
  kind: technical
  root: .
assert:
  - path_exists: { path: src/domain }
`);

      const result = runLint(tmpDir);
      assert.ok(result.issues.some(i => i.code === "technical.archtest_without_arch_rule"));
      assert.ok(result.issues.some(i => i.code === "technical.weak_architecture"));
    });
  });

  it("warns when a declared technical framework is not exercised", () => {
    withTmpDir(tmpDir => {
      mkdirs(tmpDir);
      fs.writeFileSync(path.join(tmpDir, "vp", "technical", "framework.yml"), `
id: technical-arch-framework
title: Architecture framework is declared
severity: blocker
category: architecture
runner:
  kind: archtest
  framework: dependency-cruiser
app:
  kind: technical
  root: .
assert:
  - path_exists: { path: src }
`);
      const result = runLint(tmpDir);
      assert.ok(result.issues.some(i => i.code === "technical.framework_not_exercised"));
    });
  });

  it("warns when a stateful fullstack archetype lacks its baseline bundle", () => {
    withTmpDir(tmpDir => {
      mkdirs(tmpDir);
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), `
        app.get("/calculator", handler);
        app.post("/api/calculate", handler);
        const sql = "SELECT * FROM calculation_history";
      `);
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "calculator.yml"), `
id: calculator-ui
title: Calculator UI
severity: blocker
app:
  kind: web
  base_url: http://localhost:3000
flow:
  - open: /calculator
assert:
  - text_equals: { testid: result, equals: "5" }
`);

      const result = runLint(tmpDir);
      const issue = result.issues.find(i => i.code === "vp.archetype_bundle_missing");
      assert.ok(issue);
      assert.match(issue.message, /fullstack-web-stateful/);
      assert.match(issue.message, /behavior, domain, api, database, technical/);
    });
  });

  it("warns when a REST backend service archetype lacks its baseline bundle", () => {
    withTmpDir(tmpDir => {
      mkdirs(tmpDir);
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "service.js"), `
        app.post("/quotes", async (req, res) => {
          await fetch("https://pricing.example.com/v1/quote");
          const sql = "INSERT INTO quote_history";
          return res.json({ ok: true });
        });
      `);
      fs.writeFileSync(path.join(tmpDir, "vp", "api", "quotes.yml"), `
id: quotes-api
title: Quotes API
severity: blocker
app:
  kind: api
  base_url: http://localhost:3000
request:
  method: POST
  path: /quotes
assert:
  - status: 200
`);

      const result = runLint(tmpDir);
      const issue = result.issues.find(i => i.code === "vp.archetype_bundle_missing");
      assert.ok(issue);
      assert.match(issue.message, /rest-service/);
      assert.match(issue.message, /behavior, domain, database, technical/);
    });
  });
});
