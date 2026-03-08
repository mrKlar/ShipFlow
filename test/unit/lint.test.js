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
  for (const dir of ["ui/_fixtures", "behavior", "api", "db", "nfr", "security"]) {
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
});
