#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  TODO_LIVE_MINIMAL_VP_PATHS,
  rewriteTodoLiveBaseUrls,
  todoLiveBaseUrl,
  todoLiveProviderCommand,
  withTodoLivePortInDevScript,
} from "../../test/support/todo-live.js";
import { computeVerificationPackSnapshot } from "../../lib/util/vp-snapshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const requestText = fs.readFileSync(path.join(__dirname, "request.txt"), "utf-8").trim();
const keep = process.argv.includes("--keep");
const aiDraft = process.argv.includes("--ai-draft");
const modelArg = process.argv.find(arg => arg.startsWith("--model="));
const providerArg = process.argv.find(arg => arg.startsWith("--provider="));
const provider = (providerArg ? providerArg.slice("--provider=".length) : "claude").trim();
const useWorkspaceCli = process.env.SHIPFLOW_USE_WORKSPACE_CLI !== "0";
const platformFlagByProvider = {
  claude: "--claude",
  codex: "--codex",
  gemini: "--gemini",
  kiro: "--kiro",
};
const nodeBinDir = path.dirname(process.execPath);
if (!String(process.env.PATH || "").split(path.delimiter).includes(nodeBinDir)) {
  process.env.PATH = [nodeBinDir, process.env.PATH || ""].filter(Boolean).join(path.delimiter);
}

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
  if (useWorkspaceCli) {
    return runCommand(process.execPath, [path.join(repoRoot, "bin", "shipflow.js"), ...args], cwd, options);
  }
  return runCommand("npx", ["--no-install", "shipflow", ...args], cwd, options);
}

function installLocalShipFlow(cwd) {
  runCommand("npm", ["install", "--no-save", repoRoot], cwd, { stdio: "inherit" });
}

function copyTemplateProject(targetDir, port) {
  fs.mkdirSync(path.join(targetDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, ".gitignore"), ".gen/\nevidence/\n.shipflow/\nnode_modules/\n");

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
  packageJson.scripts = {
    dev: withTodoLivePortInDevScript(packageJson.scripts.dev, port),
  };
  delete packageJson.devDependencies?.["@anthropic-ai/sdk"];
  fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");

  const shipflowConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "shipflow.json"), "utf-8"));
  shipflowConfig.impl.provider = "auto";
  const maxIterations = Number.parseInt(process.env.SHIPFLOW_LIVE_MAX_ITERATIONS || "", 10);
  if (Number.isFinite(maxIterations) && maxIterations > 0) {
    shipflowConfig.impl.maxIterations = maxIterations;
  }
  fs.writeFileSync(path.join(targetDir, "shipflow.json"), JSON.stringify(shipflowConfig, null, 2) + "\n");
  fs.writeFileSync(path.join(targetDir, "src", ".gitkeep"), "");
}

async function allocatePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(error => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function rewriteDraftBaseUrls(cwd, baseUrl) {
  const vpDir = path.join(cwd, "vp");
  if (!fs.existsSync(vpDir)) return;
  const stack = [vpDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
      const source = fs.readFileSync(full, "utf-8");
      const rewritten = rewriteTodoLiveBaseUrls(source, baseUrl);
      if (rewritten !== source) fs.writeFileSync(full, rewritten);
    }
  }
}

function rewriteDraftSessionBaseUrls(cwd, baseUrl) {
  const sessionPath = path.join(cwd, ".shipflow", "draft-session.json");
  if (!fs.existsSync(sessionPath)) return;
  const session = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
  if (Array.isArray(session.proposals)) {
    session.proposals = session.proposals.map(proposal => {
      if (proposal?.data === undefined) return proposal;
      return {
        ...proposal,
        data: JSON.parse(rewriteTodoLiveBaseUrls(JSON.stringify(proposal.data), baseUrl)),
      };
    });
  }
  session.vp_snapshot = computeVerificationPackSnapshot(cwd);
  session.updated_at = new Date().toISOString();
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + "\n");
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
  const requiredProviderCommand = todoLiveProviderCommand(provider, commandExists);
  const requiredCommands = [];
  if (requiredProviderCommand) requiredCommands.push(requiredProviderCommand);
  else missing.push(`provider CLI for ${provider}`);
  if (useWorkspaceCli) requiredCommands.push("node");
  else requiredCommands.push("npm", "npx");
  for (const cmd of requiredCommands) {
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
  const missing = TODO_LIVE_MINIMAL_VP_PATHS.filter(rel => !proposedPaths.includes(rel));
  if (missing.length > 0) {
    throw new Error(`Draft did not produce the expected proposal paths: ${missing.join(", ")}`);
  }
  const accepts = TODO_LIVE_MINIMAL_VP_PATHS.map(rel => `--accept=${rel}`);
  const rejects = proposedPaths
    .filter(rel => !TODO_LIVE_MINIMAL_VP_PATHS.includes(rel))
    .map(rel => `--reject=${rel}`);
  return [...accepts, ...rejects];
}

async function main() {
  ensurePrerequisites();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-todo-live-"));
  const port = await allocatePort();
  const baseUrl = todoLiveBaseUrl(port);
  let keepWorkingCopy = keep;
  try {
    copyTemplateProject(tmpDir, port);
    const platformFlag = platformFlagByProvider[provider];
    if (!platformFlag) {
      fail(`unsupported provider: ${provider}`);
    }
    if (!useWorkspaceCli) installLocalShipFlow(tmpDir);
    runShipFlow(["init", platformFlag], tmpDir, { stdio: "inherit" });

    const draftArgs = ["draft", "--json", requestText];
    if (aiDraft) draftArgs.push("--ai", `--provider=${provider}`);
    if (modelArg) draftArgs.push(modelArg);

    const draftResult = parseJsonResult(runShipFlow(draftArgs, tmpDir), tmpDir);
    const reviewArgs = acceptAndRejectArgs(draftResult.proposals || []);
    runShipFlow(["draft", ...reviewArgs], tmpDir, { stdio: "inherit" });
    runShipFlow(["draft", "--write"], tmpDir, { stdio: "inherit" });
    rewriteDraftBaseUrls(tmpDir, baseUrl);
    rewriteDraftSessionBaseUrls(tmpDir, baseUrl);

    const implementArgs = ["implement", `--provider=${provider}`];
    if (modelArg) implementArgs.push(modelArg);
    runShipFlow(implementArgs, tmpDir, {
      stdio: "inherit",
      env: {
        PORT: String(port),
        SHIPFLOW_BASE_URL: baseUrl,
      },
    });

    if (!fs.existsSync(path.join(tmpDir, "evidence", "implement.json"))) {
      fail("shipflow implement finished without writing evidence/implement.json.", "", tmpDir);
    }
    if (!fs.existsSync(path.join(tmpDir, "evidence", "run.json"))) {
      fail("shipflow implement finished without writing evidence/run.json.", "", tmpDir);
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

await main();
