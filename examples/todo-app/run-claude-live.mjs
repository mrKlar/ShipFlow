#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const requestText = fs.readFileSync(path.join(__dirname, "request.txt"), "utf-8").trim();
const keep = process.argv.includes("--keep");
const aiDraft = process.argv.includes("--ai-draft");
const modelArg = process.argv.find(arg => arg.startsWith("--model="));
const providerArg = process.argv.find(arg => arg.startsWith("--provider="));
const provider = (providerArg ? providerArg.slice("--provider=".length) : "claude").trim();
const platformFlagByProvider = {
  claude: "--claude",
  codex: "--codex",
  gemini: "--gemini",
  kiro: "--kiro",
};

const CANONICAL_PATHS = [
  "vp/ui/add-todo.yml",
  "vp/ui/complete-todo.yml",
  "vp/ui/filter-todos.yml",
  "vp/behavior/get-api-todos-flow.yml",
  "vp/api/get-todos.yml",
  "vp/api/post-todos.yml",
  "vp/db/todos-state.yml",
  "vp/technical/framework-stack.yml",
  "vp/technical/api-protocol.yml",
  "vp/technical/sqlite-runtime.yml",
];

function commandExists(cmd) {
  const result = spawnSync("bash", ["-lc", `command -v ${cmd}`], { stdio: "pipe" });
  return result.status === 0;
}

function supportsNodeSqlite() {
  const major = Number.parseInt(process.versions.node.split(".")[0] || "0", 10);
  return Number.isFinite(major) && major >= 22;
}

function fail(message, details = "", cwd = null) {
  console.error(`ShipFlow live todo example failed: ${message}`);
  if (details) console.error(details);
  if (cwd) console.error(`Working copy kept at: ${cwd}`);
  process.exit(1);
}

function runCommand(bin, args, cwd, options = {}) {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: "utf-8",
    stdio: options.stdio || "pipe",
    env: { ...process.env, ...(options.env || {}) },
  });
  if ((result.status ?? 1) !== 0) {
    const detail = `${result.stdout || ""}${result.stderr || ""}`.trim();
    fail(`command failed: ${bin} ${args.join(" ")}`, detail, cwd);
  }
  return result;
}

function runShipFlow(args, cwd, options = {}) {
  return runCommand("npx", ["--no-install", "shipflow", ...args], cwd, options);
}

function installLocalShipFlow(cwd) {
  runCommand("npm", ["install", "--no-save", repoRoot], cwd, { stdio: "inherit" });
}

function copyTemplateProject(targetDir) {
  fs.mkdirSync(path.join(targetDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, ".gitignore"), ".gen/\nevidence/\n.shipflow/\nnode_modules/\n");

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
  packageJson.scripts = {
    dev: packageJson.scripts.dev,
  };
  delete packageJson.devDependencies?.["@anthropic-ai/sdk"];
  fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");

  const shipflowConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "shipflow.json"), "utf-8"));
  shipflowConfig.impl.provider = "auto";
  fs.writeFileSync(path.join(targetDir, "shipflow.json"), JSON.stringify(shipflowConfig, null, 2) + "\n");
  fs.writeFileSync(path.join(targetDir, "src", ".gitkeep"), "");
}

function parseJsonResult(result, cwd) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`expected JSON output but parsing failed: ${error.message}`, result.stdout, cwd);
  }
}

function ensurePrerequisites() {
  const missing = [];
  const requiredProviderCommand = provider === "kiro" ? "kiro-cli" : provider;
  for (const cmd of [requiredProviderCommand, "npm", "npx"]) {
    if (!commandExists(cmd)) missing.push(cmd);
  }
  if (!commandExists("sqlite3") && !supportsNodeSqlite()) {
    missing.push("sqlite3 or Node with node:sqlite support");
  }
  if (missing.length > 0) {
    fail(`missing required commands: ${missing.join(", ")}`);
  }
}

function acceptAndRejectArgs(proposals) {
  const proposedPaths = proposals.map(proposal => proposal.path);
  const missing = CANONICAL_PATHS.filter(rel => !proposedPaths.includes(rel));
  if (missing.length > 0) {
    throw new Error(`Draft did not produce the expected proposal paths: ${missing.join(", ")}`);
  }
  const accepts = CANONICAL_PATHS.map(rel => `--accept=${rel}`);
  const rejects = proposedPaths
    .filter(rel => !CANONICAL_PATHS.includes(rel))
    .map(rel => `--reject=${rel}`);
  return [...accepts, ...rejects];
}

function main() {
  ensurePrerequisites();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-todo-live-"));
  let keepWorkingCopy = keep;
  try {
    copyTemplateProject(tmpDir);
    installLocalShipFlow(tmpDir);
    const platformFlag = platformFlagByProvider[provider];
    if (!platformFlag) {
      fail(`unsupported provider: ${provider}`);
    }
    runShipFlow(["init", platformFlag], tmpDir, { stdio: "inherit" });

    const draftArgs = ["draft", "--json", requestText];
    if (aiDraft) draftArgs.push("--ai", `--provider=${provider}`);
    if (modelArg) draftArgs.push(modelArg);

    const draftResult = parseJsonResult(runShipFlow(draftArgs, tmpDir), tmpDir);
    const reviewArgs = acceptAndRejectArgs(draftResult.proposals || []);
    runShipFlow(["draft", ...reviewArgs], tmpDir, { stdio: "inherit" });
    runShipFlow(["draft", "--write"], tmpDir, { stdio: "inherit" });

    const implementArgs = ["implement", `--provider=${provider}`];
    if (modelArg) implementArgs.push(modelArg);
    runShipFlow(implementArgs, tmpDir, { stdio: "inherit" });

    const implementEvidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "implement.json"), "utf-8"));
    const runEvidence = JSON.parse(fs.readFileSync(path.join(tmpDir, "evidence", "run.json"), "utf-8"));
    if (!implementEvidence.ok || !runEvidence.ok) {
      fail("implementation loop finished without a green run.", JSON.stringify({ implementEvidence, runEvidence }, null, 2), tmpDir);
    }

    keepWorkingCopy = true;
    console.log(`ShipFlow live todo example passed for provider=${provider}. Working copy: ${tmpDir}`);
  } catch (error) {
    keepWorkingCopy = true;
    fail(error.message, error.stack || "", tmpDir);
  } finally {
    if (!keepWorkingCopy) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
