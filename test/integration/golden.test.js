import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gen } from "../../lib/gen.js";
import { verify } from "../../lib/verify.js";
import { sha256 } from "../../lib/util/hash.js";
import { assertGolden, normalizeGoldenJson } from "../support/golden.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../fixtures");

function copyFixtureProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-golden-gen-"));
  fs.mkdirSync(path.join(tmpDir, "vp"), { recursive: true });
  fs.cpSync(path.join(fixturesDir, "vp"), path.join(tmpDir, "vp"), { recursive: true });
  return tmpDir;
}

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
  const items = files.map(file => ({
    path: path.relative(tmpDir, file).replaceAll("\\", "/"),
    sha256: sha256(fs.readFileSync(file)),
  })).sort((a, b) => a.path.localeCompare(b.path));
  return {
    version: 1,
    created_at: new Date().toISOString(),
    vp_sha256: sha256(Buffer.from(JSON.stringify(items))),
    files: items,
  };
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 });
}

function read(file) {
  return fs.readFileSync(file, "utf-8");
}

function readNormalizedJson(file) {
  return `${JSON.stringify(normalizeGoldenJson(JSON.parse(read(file))), null, 2)}\n`;
}

describe("golden snapshots", () => {
  it("matches generated artifact snapshots", async () => {
    const tmpDir = copyFixtureProject();
    const genDir = path.join(tmpDir, ".gen");
    try {
      await gen({ cwd: tmpDir });

      assertGolden("gen/manifest.json", readNormalizedJson(path.join(genDir, "manifest.json")));
      assertGolden("gen/playwright.config.mjs", read(path.join(genDir, "playwright.config.mjs")));
      assertGolden("gen/vp_ui_login.test.ts", read(path.join(genDir, "playwright", "vp_ui_login.test.ts")));
      assertGolden("gen/vp_behavior_checkout.test.ts", read(path.join(genDir, "playwright", "vp_behavior_checkout.test.ts")));
      assertGolden("gen/vp_api_list-users.test.ts", read(path.join(genDir, "playwright", "vp_api_list-users.test.ts")));
      assertGolden("gen/vp_db_users-seeded.test.ts", read(path.join(genDir, "playwright", "vp_db_users-seeded.test.ts")));
      assertGolden("gen/vp_security_unauthenticated-admin.test.ts", read(path.join(genDir, "playwright", "vp_security_unauthenticated-admin.test.ts")));
      assertGolden("gen/vp_technical_ci-stack.runner.mjs", read(path.join(genDir, "technical", "vp_technical_ci-stack.runner.mjs")));
      assertGolden("gen/vp_nfr_load-test.js", read(path.join(genDir, "k6", "vp_nfr_load-test.js")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("matches verification evidence snapshots", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-golden-verify-"));
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
      fs.writeFileSync(path.join(tmpDir, ".gen", "vp.lock.json"), JSON.stringify(buildLock(tmpDir), null, 2));
      fs.writeFileSync(path.join(tmpDir, ".gen", "manifest.json"), JSON.stringify({
        version: 1,
        outputs: {
          ui: {
            label: "UI",
            output_kind: "playwright",
            output_dir: "playwright",
            evidence_file: "ui.json",
            count: 1,
            files: [".gen/playwright/vp_ui_home.test.ts"],
            checks: [{ id: "ui-home", title: "Home", severity: "blocker", file: ".gen/playwright/vp_ui_home.test.ts" }],
          },
          nfr: {
            label: "Performance",
            output_kind: "k6",
            output_dir: "k6",
            evidence_file: "load.json",
            count: 1,
            files: [".gen/k6/vp_nfr_smoke.js"],
            checks: [{ id: "nfr-smoke", title: "Smoke", severity: "blocker", file: ".gen/k6/vp_nfr_smoke.js" }],
          },
        },
      }, null, 2));

      writeExecutable(path.join(binDir, "npx"), "#!/usr/bin/env bash\necho '1 passed'\n");
      writeExecutable(path.join(binDir, "k6"), "#!/usr/bin/env bash\nif [ \"$1\" = \"version\" ]; then exit 0; fi\nif [ \"$1\" = \"run\" ]; then echo 'k6 ok'; exit 0; fi\nexit 0\n");

      process.env.PATH = `${binDir}:${previousPath}`;
      const result = await verify({ cwd: tmpDir, capture: true });
      assert.equal(result.exitCode, 0);

      const evidDir = path.join(tmpDir, "evidence");
      assertGolden("verify/run.json", readNormalizedJson(path.join(evidDir, "run.json")));
      assertGolden("verify/ui.json", readNormalizedJson(path.join(evidDir, "ui.json")));
      assertGolden("verify/load.json", readNormalizedJson(path.join(evidDir, "load.json")));
      assertGolden("verify/policy.json", readNormalizedJson(path.join(evidDir, "policy.json")));
    } finally {
      process.env.PATH = previousPath;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
