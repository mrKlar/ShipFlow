import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadLock, verifyLock, parseSummary, verify, collectGeneratedFilesByType, collectGeneratedChecksByType } from "../../lib/verify.js";
import { buildVerificationLock } from "../../lib/util/verification-lock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildLock(tmpDir) {
  return buildVerificationLock(tmpDir, { createdAt: "2026-03-08T00:00:00.000Z" });
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
    const genDir = path.join(tmpDir, ".gen");
    fs.mkdirSync(vpDir, { recursive: true });
    fs.mkdirSync(genDir, { recursive: true });
    fs.writeFileSync(path.join(vpDir, "check.yml"), "id: test\n");
    fs.writeFileSync(path.join(genDir, "manifest.json"), JSON.stringify({ version: 1, outputs: {} }, null, 2));
    const lock = buildLock(tmpDir);

    try {
      assert.doesNotThrow(() => verifyLock(tmpDir, lock));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when VP does not match lock", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    const vpDir = path.join(tmpDir, "vp", "ui");
    const genDir = path.join(tmpDir, ".gen");
    fs.mkdirSync(vpDir, { recursive: true });
    fs.mkdirSync(genDir, { recursive: true });
    fs.writeFileSync(path.join(vpDir, "check.yml"), "id: test\n");
    fs.writeFileSync(path.join(genDir, "manifest.json"), JSON.stringify({ version: 1, outputs: {} }, null, 2));

    const lock = { ...buildLock(tmpDir), vp_sha256: "wrong-hash" };
    try {
      assert.throws(() => verifyLock(tmpDir, lock), /Verification pack changed/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when generated artifacts do not match lock", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    const vpDir = path.join(tmpDir, "vp", "ui");
    const genDir = path.join(tmpDir, ".gen");
    fs.mkdirSync(vpDir, { recursive: true });
    fs.mkdirSync(genDir, { recursive: true });
    fs.writeFileSync(path.join(vpDir, "check.yml"), "id: test\n");
    fs.writeFileSync(path.join(genDir, "manifest.json"), JSON.stringify({ version: 1, outputs: {} }, null, 2));

    const lock = buildLock(tmpDir);
    fs.writeFileSync(path.join(genDir, "manifest.json"), JSON.stringify({ version: 1, outputs: { ui: { count: 1 } } }, null, 2));

    try {
      assert.throws(() => verifyLock(tmpDir, lock), /Generated artifacts changed/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when lock does not cover generated artifacts", () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-"));
    const vpDir = path.join(tmpDir, "vp", "ui");
    const genDir = path.join(tmpDir, ".gen");
    fs.mkdirSync(vpDir, { recursive: true });
    fs.mkdirSync(genDir, { recursive: true });
    fs.writeFileSync(path.join(vpDir, "check.yml"), "id: test\n");
    fs.writeFileSync(path.join(genDir, "manifest.json"), JSON.stringify({ version: 1, outputs: {} }, null, 2));

    const lock = buildLock(tmpDir);
    delete lock.generated_sha256;
    delete lock.generated_files;

    try {
      assert.throws(() => verifyLock(tmpDir, lock), /does not cover generated artifacts/);
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

      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          ui: { files: [".gen/playwright/vp_ui_home.test.ts"] },
          nfr: { files: [".gen/k6/vp_nfr_smoke.js"] },
        },
      }, null, 2));
      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));

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

  it("passes SHIPFLOW_EVIDENCE_DIR to Playwright runners", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-verify-"));
    const binDir = path.join(tmpDir, "bin");
    const marker = path.join(tmpDir, "playwright-evidence-dir.txt");
    const previousPath = process.env.PATH;
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "playwright"), { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });

      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), "id: home\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "playwright", "vp_ui_home.test.ts"), "import { test, expect } from \"@playwright/test\";\ntest(\"x\", async () => {});\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          ui: { files: [".gen/playwright/vp_ui_home.test.ts"] },
        },
      }, null, 2));
      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));

      writeExecutable(path.join(binDir, "npx"), `#!/usr/bin/env bash\nprintf '%s' \"$SHIPFLOW_EVIDENCE_DIR\" > ${JSON.stringify(marker)}\necho '1 passed'\n`);
      process.env.PATH = `${binDir}:${previousPath}`;

      const result = await verify({ cwd: tmpDir, capture: true });
      assert.equal(result.exitCode, 0);
      assert.equal(fs.readFileSync(marker, "utf-8"), path.join(tmpDir, "evidence"));
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

      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          ui: { files: [".gen/playwright/vp_ui_home.test.ts"] },
          nfr: { files: [".gen/k6/vp_nfr_smoke.js"] },
        },
      }, null, 2));
      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));

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

  it("fails when performance checks are present but k6 is not installed", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-verify-"));
    const binDir = path.join(tmpDir, "bin");
    const previousPath = process.env.PATH;
    try {
      fs.mkdirSync(path.join(tmpDir, "vp"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "k6"), { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });

      fs.writeFileSync(path.join(tmpDir, ".gen", "k6", "vp_nfr_smoke.js"), "export default function() {}\n");

      fs.mkdirSync(path.join(tmpDir, ".gen"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          nfr: {
            files: [".gen/k6/vp_nfr_smoke.js"],
            checks: [{ id: "perf-smoke", severity: "blocker", file: ".gen/k6/vp_nfr_smoke.js" }],
          },
        },
      }, null, 2));
      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));

      writeExecutable(path.join(binDir, "npx"), "#!/usr/bin/env bash\necho '0 passed'\n");
      process.env.PATH = `${binDir}:${previousPath}`;
      const result = await verify({ cwd: tmpDir, capture: true });

      assert.equal(result.exitCode, 1);
      const load = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "load.json"), "utf-8"));
      assert.equal(load.ok, false);
      assert.equal(load.reason, "k6 not installed");
      const run = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "run.json"), "utf-8"));
      assert.equal(run.ok, false);
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

      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          ui: {
            files: [".gen/playwright/vp_ui_home.test.ts"],
            checks: [{ id: "ui-home", severity: "warn", file: ".gen/playwright/vp_ui_home.test.ts" }],
          },
        },
      }, null, 2));
      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));

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

  it("runs generated Cucumber behavior features", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-verify-"));
    const binDir = path.join(tmpDir, "bin");
    const previousPath = process.env.PATH;
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "behavior"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "cucumber", "features"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "cucumber", "step_definitions"), { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });

      fs.writeFileSync(path.join(tmpDir, "vp", "behavior", "checkout.yml"), "id: checkout\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "cucumber", "features", "checkout.feature"), "Feature: Checkout\n  Scenario: checkout\n    Given ShipFlow noop\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "cucumber", "step_definitions", "checkout.steps.mjs"), "import { Given } from \"@cucumber/cucumber\";\nGiven(\"ShipFlow noop\", async function () {});\n");

      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          behavior_gherkin: {
            files: [
              ".gen/cucumber/features/checkout.feature",
              ".gen/cucumber/step_definitions/checkout.steps.mjs",
            ],
            checks: [{
              id: "behavior-checkout",
              severity: "blocker",
              file: ".gen/cucumber/features/checkout.feature",
              companion_files: [".gen/cucumber/step_definitions/checkout.steps.mjs"],
            }],
          },
        },
      }, null, 2));
      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));

      writeExecutable(path.join(binDir, "npx"), "#!/usr/bin/env bash\nif [ \"$1\" = \"cucumber-js\" ]; then echo '1 passed'; exit 0; fi\necho '0 passed'\n");
      process.env.PATH = `${binDir}:${previousPath}`;
      const result = await verify({ cwd: tmpDir, capture: true });

      assert.equal(result.exitCode, 0);
      const behavior = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "behavior-gherkin.json"), "utf-8"));
      assert.equal(behavior.ok, true);
      assert.ok(behavior.files.some(file => file.endsWith(".feature")));
    } finally {
      process.env.PATH = previousPath;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails when a reachable local web server is not owned by ShipFlow", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-verify-"));
    const binDir = path.join(tmpDir, "bin");
    const previousPath = process.env.PATH;
    const previousFetch = global.fetch;
    const port = 41234;
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "behavior"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "cucumber", "features"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "cucumber", "step_definitions"), { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });

      fs.writeFileSync(path.join(tmpDir, "vp", "behavior", "checkout.yml"), "id: checkout\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "cucumber", "features", "checkout.feature"), "Feature: Checkout\n  Scenario: checkout\n    Given ShipFlow noop\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "cucumber", "step_definitions", "checkout.steps.mjs"), "import { Given } from \"@cucumber/cucumber\";\nGiven(\"ShipFlow noop\", async function () {});\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "playwright.config.mjs"), [
        'import { defineConfig } from "@playwright/test";',
        `const baseURL = process.env.SHIPFLOW_BASE_URL || "http://127.0.0.1:${port}";`,
        'const webServerCommand = process.env.SHIPFLOW_WEB_SERVER_COMMAND || "node ./server.mjs";',
        'const hasExternalWebServer = process.env.SHIPFLOW_EXTERNAL_WEB_SERVER === "1";',
        "const shouldStartWebServer = !hasExternalWebServer && (true || Boolean(process.env.SHIPFLOW_WEB_SERVER_COMMAND));",
        "export default defineConfig({ use: { baseURL } });",
        "",
      ].join("\n"));

      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          behavior_gherkin: {
            files: [
              ".gen/cucumber/features/checkout.feature",
              ".gen/cucumber/step_definitions/checkout.steps.mjs",
            ],
            checks: [{
              id: "behavior-checkout",
              severity: "blocker",
              file: ".gen/cucumber/features/checkout.feature",
              companion_files: [".gen/cucumber/step_definitions/checkout.steps.mjs"],
            }],
          },
        },
      }, null, 2));
      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));

      writeExecutable(path.join(binDir, "npx"), "#!/usr/bin/env bash\nif [ \"$1\" = \"cucumber-js\" ]; then echo '1 passed'; exit 0; fi\necho '0 passed'\n");
      process.env.PATH = `${binDir}:${previousPath}`;
      global.fetch = async () => ({ ok: true, status: 200 });
      const result = await verify({ cwd: tmpDir, capture: true });

      assert.equal(result.exitCode, 1);
      const run = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "run.json"), "utf-8"));
      assert.equal(run.ok, false);
      assert.equal(run.failed, 1);
      const runtimeLog = fs.readFileSync(path.join(tmpDir, "evidence", "artifacts", "managed-runtime.log"), "utf-8");
      assert.match(runtimeLog, /not owned by ShipFlow/);
    } finally {
      global.fetch = previousFetch;
      process.env.PATH = previousPath;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs generated technical runners", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-verify-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "technical"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "technical"), { recursive: true });

      fs.writeFileSync(path.join(tmpDir, "vp", "technical", "ci.yml"), "id: technical-ci\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "technical", "vp_technical_ci.runner.mjs"), "console.log('technical ok');\n");

      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          technical: {
            files: [".gen/technical/vp_technical_ci.runner.mjs"],
            checks: [{
              id: "technical-ci",
              severity: "blocker",
              file: ".gen/technical/vp_technical_ci.runner.mjs",
            }],
          },
        },
      }, null, 2));
      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));

      const result = await verify({ cwd: tmpDir, capture: true });

      assert.equal(result.exitCode, 0);
      const technical = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "technical.json"), "utf-8"));
      assert.equal(technical.ok, true);
      assert.equal(technical.passed, 1);
      assert.ok(technical.runners[0].file.endsWith(".runner.mjs"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs generated business-domain runners", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-verify-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "domain"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".gen", "domain"), { recursive: true });

      fs.writeFileSync(path.join(tmpDir, "vp", "domain", "todo.yml"), "id: domain-todo\n");
      fs.writeFileSync(path.join(tmpDir, ".gen", "domain", "vp_domain_todo.runner.mjs"), "console.log('business domain ok');\n");

      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          domain: {
            files: [".gen/domain/vp_domain_todo.runner.mjs"],
            checks: [{
              id: "domain-todo",
              severity: "blocker",
              file: ".gen/domain/vp_domain_todo.runner.mjs",
            }],
          },
        },
      }, null, 2));
      const lock = buildLock(tmpDir);
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(lock, null, 2));

      const result = await verify({ cwd: tmpDir, capture: true });

      assert.equal(result.exitCode, 0);
      const domain = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "domain.json"), "utf-8"));
      assert.equal(domain.label, "Business Domain");
      assert.equal(domain.ok, true);
      assert.equal(domain.passed, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
