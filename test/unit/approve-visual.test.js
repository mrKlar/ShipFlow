import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { approveVisual } from "../../lib/approve-visual.js";

function writeExecutable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 });
}

describe("approveVisual", () => {
  it("runs visual UI checks in approval mode and writes locked baselines under vp/ui/_baselines", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-approve-visual-"));
    const binDir = path.join(tmpDir, "bin");
    const argsMarker = path.join(tmpDir, "playwright-args.txt");
    const envMarker = path.join(tmpDir, "approve-env.txt");
    const baselineDir = path.join(tmpDir, "vp", "ui", "_baselines", "ui-home-visual");
    const baselineFile = path.join(baselineDir, "home.desktop.light.png");
    const previousPath = process.env.PATH;

    try {
      fs.mkdirSync(path.join(tmpDir, "vp", "ui"), { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "vp", "ui", "home.yml"), [
        "id: ui-home-visual",
        "title: Home visual contract",
        "severity: blocker",
        "app:",
        "  kind: web",
        "  base_url: http://localhost:3000",
        "flow:",
        "  - open: /",
        "targets:",
        "  shell:",
        "    testid: home-shell",
        "assert:",
        "  - visible:",
        "      testid: home-shell",
        "visual:",
        "  context:",
        "    viewport:",
        "      width: 1280",
        "      height: 720",
        "    color_scheme: light",
        "    reduced_motion: true",
        "    wait_for_fonts: true",
        "  snapshots:",
        "    - name: home.desktop.light",
        "      target: shell",
        "      max_diff_ratio: 0",
        "      per_pixel_threshold: 0.1",
        "",
      ].join("\n"));

      writeExecutable(path.join(binDir, "npx"), `#!/usr/bin/env bash
printf '%s\n' "$*" > ${JSON.stringify(argsMarker)}
printf '%s\n%s\n' "$SHIPFLOW_APPROVE_VISUAL" "$SHIPFLOW_EVIDENCE_DIR" > ${JSON.stringify(envMarker)}
mkdir -p ${JSON.stringify(baselineDir)}
printf 'approved' > ${JSON.stringify(baselineFile)}
exit 0
`);

      process.env.PATH = `${binDir}:${previousPath}`;
      const result = await approveVisual({ cwd: tmpDir, input: "ui-home-visual" });

      assert.equal(result.exitCode, 0);
      assert.equal(fs.existsSync(baselineFile), true);
      assert.match(fs.readFileSync(argsMarker, "utf-8"), /playwright test --config \.gen\/playwright\.config\.mjs --reporter=list \.gen\/playwright\/vp_ui_home\.test\.ts/);
      assert.equal(fs.readFileSync(envMarker, "utf-8"), `1\n${path.join(tmpDir, "evidence")}\n`);
      assert.equal(fs.existsSync(path.join(tmpDir, ".gen", "vp.lock.json")), true);
    } finally {
      process.env.PATH = previousPath;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
