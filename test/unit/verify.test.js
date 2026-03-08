import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadLock, verifyLock, parseSummary, verify, collectGeneratedFilesByType, collectGeneratedChecksByType } from "../../lib/verify.js";
import { sha256 } from "../../lib/util/hash.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildLock(tmpDir) {
  const vpDir = path.join(tmpDir, "vp");
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(vpDir);
  const items = files.map(file => {
    const rel = path.relative(tmpDir, file).replaceAll("\\", "/");
    return { path: rel, sha256: sha256(fs.readFileSync(file)) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return { version: 1, vp_sha256: sha256(Buffer.from(JSON.stringify(items))), files: items };
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 });
}

describe("loadLock", () => {
  it("throws if .gen/vp.lock.json does not exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    try {
      assert.throws(() => loadLock(tmpDir), /Missing .gen\/vp.lock.json/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns parsed lock when file exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    const genDir = path.join(tmpDir, ".gen");
    fs.mkdirSync(genDir, { recursive: true });
    const lock = { version: 1, vp_sha256: "abc123", files: [] };
    fs.writeFileSync(path.join(genDir, "vp.lock.json"), JSON.stringify(lock));
    try {
      const result = loadLock(tmpDir);
      assert.equal(result.version, 1);
      assert.equal(result.vp_sha256, "abc123");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("verifyLock", () => {
  it("passes when VP matches lock", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    const vpDir = path.join(tmpDir, "vp", "ui");
    fs.mkdirSync(vpDir, { recursive: true });
    fs.writeFileSync(path.join(vpDir, "check.yml"), "id: test\n");

    const rel = path.relative(tmpDir, path.join(vpDir, "check.yml")).replaceAll("\\", "/");
    const buf = fs.readFileSync(path.join(vpDir, "check.yml"));
    const items = [{ path: rel, sha256: sha256(buf) }];
    const vpSha = sha256(Buffer.from(JSON.stringify(items)));
    const lock = { vp_sha256: vpSha };

    try {
      assert.doesNotThrow(() => verifyLock(tmpDir, lock));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when VP does not match lock", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    const vpDir = path.join(tmpDir, "vp", "ui");
    fs.mkdirSync(vpDir, { recursive: true });
    fs.writeFileSync(path.join(vpDir, "check.yml"), "id: test\n");

    const lock = { vp_sha256: "wrong-hash" };
    try {
      assert.throws(() => verifyLock(tmpDir, lock), /Verification pack changed/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("parseSummary", () => {
  it("extracts passed count", () => {
    const s = parseSummary("  10 passed (5s)\n");
    assert.equal(s.passed, 10);
  });

  it("extracts failed count", () => {
    const s = parseSummary("  3 failed\n  7 passed\n");
    assert.equal(s.failed, 3);
    assert.equal(s.passed, 7);
  });

  it("extracts skipped count", () => {
    const s = parseSummary("  2 skipped\n  5 passed\n");
    assert.equal(s.skipped, 2);
    assert.equal(s.passed, 5);
  });

  it("returns zeros for no matches", () => {
    const s = parseSummary("no useful output here");
    assert.equal(s.passed, 0);
    assert.equal(s.failed, 0);
    assert.equal(s.skipped, 0);
  });

  it("handles combined summary line", () => {
    const s = parseSummary("  5 passed, 2 failed, 1 skipped");
    assert.equal(s.passed, 5);
    assert.equal(s.failed, 2);
    assert.equal(s.skipped, 1);
  });
});

describe("collectGeneratedFilesByType", () => {
  it("prefers manifest outputs when available", () => {
    const files = collectGeneratedFilesByType("/tmp/project", {
      outputs: { ui: { files: [".gen/playwright/vp_ui_home.test.ts"] } },
    }, {
      id: "ui",
      output_dir: "playwright",
    });
    assert.deepEqual(files, [".gen/playwright/vp_ui_home.test.ts"]);
  });
});

describe("collectGeneratedChecksByType", () => {
  it("returns manifest check metadata when available", () => {
    const checks = collectGeneratedChecksByType("/tmp/project", {
      outputs: {
        ui: {
          checks: [{ id: "ui-home", severity: "warn", file: ".gen/playwright/vp_ui_home.test.ts" }],
        },
      },
    }, {
      id: "ui",
      output_dir: "playwright",
    });
    assert.equal(checks[0].severity, "warn");
  });
});

describe("verify", () => {
  it("writes aggregate and phase evidence with fake runners", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-verify-"));
    const binDir = path.join(tmpDir, "bin");
    const previousPath = process.env.PATH;
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "playwright"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "k6"), { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });

      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "playwright", "vp_ui_home.test.ts"), "import { test, expect } from \"@playwright/test\";\ntest(\"x\", async () => {});\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "k6", "vp_nfr_smoke.js"), "export default function() {}\n");

      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));
      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          ui: { files: [".gen/playwright/vp_ui_home.test.ts"] },
          nfr: { files: [".gen/k6/vp_nfr_smoke.js"] },
        },
      }, null, 2));

      writeExecutable(path.join(binDir, "npx"), "#!/usr/bin/env bash\necho '1 passed'\n");
      writeExecutable(path.join(binDir, "k6"), "#!/usr/bin/env bash\nif [ \"$1\" = \"version\" ]; then exit 0; fi\nif [ \"$1\" = \"run\" ]; then echo 'k6 ok'; exit 0; fi\nexit 0\n");

      process.env.PATH = `${binDir}:${previousPath}`;
      const result = await verify({ cwd: tmpDir, capture: true });

      assert.equal(result.exitCode, 0);
      const evidDir = path.join(tmpDir, "evidence");
      assert.ok(fs.existsSync(path.join(evidDir, "run.json")));
      assert.ok(fs.existsSync(path.join(evidDir, "ui.json")));
      assert.ok(fs.existsSync(path.join(evidDir, "load.json")));
      assert.ok(fs.existsSync(path.join(evidDir, "policy.json")));

      const run = JSON.parse(fs.readFileSync(path.join(evidDir, "run.json"), "utf-8"));
      assert.equal(run.ok, true);
      assert.ok(Array.isArray(run.groups));
    } finally {
      process.env.PATH = previousPath;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails when performance scripts fail even if Playwright passes", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-verify-"));
    const binDir = path.join(tmpDir, "bin");
    const previousPath = process.env.PATH;
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "playwright"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "k6"), { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });

      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "playwright", "vp_ui_home.test.ts"), "import { test, expect } from \"@playwright/test\";\ntest(\"x\", async () => {});\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "k6", "vp_nfr_smoke.js"), "export default function() {}\n");

      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));
      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          ui: { files: [".gen/playwright/vp_ui_home.test.ts"] },
          nfr: { files: [".gen/k6/vp_nfr_smoke.js"] },
        },
      }, null, 2));

      writeExecutable(path.join(binDir, "npx"), "#!/usr/bin/env bash\necho '1 passed'\n");
      writeExecutable(path.join(binDir, "k6"), "#!/usr/bin/env bash\nif [ \"$1\" = \"version\" ]; then exit 0; fi\nif [ \"$1\" = \"run\" ]; then echo 'k6 failed' >&2; exit 1; fi\nexit 0\n");

      process.env.PATH = `${binDir}:${previousPath}`;
      const result = await verify({ cwd: tmpDir, capture: true });

      assert.equal(result.exitCode, 1);
      const load = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "load.json"), "utf-8"));
      assert.equal(load.ok, false);
    } finally {
      process.env.PATH = previousPath;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not fail the run when only warn checks fail", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-verify-"));
    const binDir = path.join(tmpDir, "bin");
    const previousPath = process.env.PATH;
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "playwright"), { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });

      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "playwright", "vp_ui_home.test.ts"), "import { test, expect } from \"@playwright/test\";\ntest(\"x\", async () => {});\n");

      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));
      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          ui: {
            files: [".gen/playwright/vp_ui_home.test.ts"],
            checks: [{ id: "ui-home", severity: "warn", file: ".gen/playwright/vp_ui_home.test.ts" }],
          },
        },
      }, null, 2));

      writeExecutable(path.join(binDir, "npx"), "#!/usr/bin/env bash\necho '1 failed'\nexit 1\n");
      process.env.PATH = `${binDir}:${previousPath}`;
      const result = await verify({ cwd: tmpDir, capture: true });
      assert.equal(result.exitCode, 0);
      const run = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "run.json"), "utf-8"));
      assert.equal(run.ok, true);
      assert.equal(run.advisory_failed, 1);
    } finally {
      process.env.PATH = previousPath;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
