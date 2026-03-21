import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveCompatiblePlaywrightNode, runPlaywrightCommand } from "../../lib/util/playwright-cli.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-playwright-cli-"));
  try {
    return fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function writeFakeNode(filePath, version, markerPath = null) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    "#!/bin/bash",
    'if [ "$1" = "-v" ]; then',
      `  echo "v${version}"`,
    "  exit 0",
    "fi",
  ];
  if (markerPath) {
    lines.push(`printf '%s\n' "$@" > ${JSON.stringify(markerPath)}`);
  }
  lines.push("exit 0", "");
  fs.writeFileSync(filePath, lines.join("\n"), { mode: 0o755 });
}

function spawnWithResolvedNode(currentNode) {
  return (bin, args, options = {}) => {
    if (bin === "bash" && args[0] === "-lc" && String(args[1] || "").includes("command -v node")) {
      return { status: 0, stdout: `${currentNode}\n`, stderr: "" };
    }
    return spawnSync(bin, args, options);
  };
}

describe("resolveCompatiblePlaywrightNode", () => {
  it("keeps the current node when it is already compatible", () => {
    withTmpDir(tmpDir => {
      const homeDir = path.join(tmpDir, "home");
      const currentNode = path.join(tmpDir, "toolchain", "bin", "node");
      writeFakeNode(currentNode, "22.22.1");

      const resolved = resolveCompatiblePlaywrightNode(tmpDir, {
        spawnSync: spawnWithResolvedNode(currentNode),
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: path.dirname(currentNode),
        },
      });

      assert.equal(path.resolve(resolved.path), path.resolve(currentNode));
      assert.equal(resolved.major, 22);
    });
  });

  it("falls back to the highest installed LTS node when the current runtime is too new", () => {
    withTmpDir(tmpDir => {
      const homeDir = path.join(tmpDir, "home");
      const currentNode = path.join(tmpDir, "toolchain", "bin", "node");
      const node20 = path.join(homeDir, ".nvm", "versions", "node", "v20.20.1", "bin", "node");
      const node22 = path.join(homeDir, ".nvm", "versions", "node", "v22.99.0", "bin", "node");
      writeFakeNode(currentNode, "25.8.0");
      writeFakeNode(node20, "20.20.1");
      writeFakeNode(node22, "22.99.0");

      const resolved = resolveCompatiblePlaywrightNode(tmpDir, {
        spawnSync: spawnWithResolvedNode(currentNode),
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: path.dirname(currentNode),
        },
      });

      assert.equal(path.resolve(resolved.path), path.resolve(node22));
      assert.equal(resolved.major, 22);
    });
  });
});

describe("runPlaywrightCommand", () => {
  it("executes the Playwright CLI with the selected compatible node", () => {
    withTmpDir(tmpDir => {
      const homeDir = path.join(tmpDir, "home");
      const currentNode = path.join(tmpDir, "toolchain", "bin", "node");
      const node22 = path.join(homeDir, ".nvm", "versions", "node", "v22.99.0", "bin", "node");
      const marker = path.join(tmpDir, "playwright-args.txt");
      const cliPath = path.join(tmpDir, "node_modules", "playwright", "cli.js");
      const packageJson = path.join(tmpDir, "node_modules", "playwright", "package.json");

      writeFakeNode(currentNode, "25.8.0");
      writeFakeNode(node22, "22.99.0", marker);
      fs.mkdirSync(path.dirname(cliPath), { recursive: true });
      fs.writeFileSync(packageJson, JSON.stringify({ name: "playwright" }, null, 2));
      fs.writeFileSync(cliPath, "");

      const result = runPlaywrightCommand(tmpDir, ["test", "--list", "sample.test.ts"], {
        spawnSync: spawnWithResolvedNode(currentNode),
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: path.dirname(currentNode),
        },
      });

      assert.equal(result.status, 0);
      assert.equal(
        fs.readFileSync(marker, "utf-8"),
        `${cliPath}\ntest\n--list\nsample.test.ts\n`,
      );
    });
  });
});
