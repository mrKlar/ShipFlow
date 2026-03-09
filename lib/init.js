import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { green, dim } from "./util/color.js";
import { buildDraft, seedDraftSession } from "./draft.js";
import { resolveAutoProvider } from "./providers/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shipflowRoot = path.resolve(__dirname, "..");

function isGloballyInstalled() {
  return commandExists("shipflow-guard");
}

function guardCommand() {
  if (isGloballyInstalled()) return "shipflow-guard";
  return `node "${path.join(shipflowRoot, "hooks", "guard-paths.js")}"`;
}

function stopCommand() {
  if (isGloballyInstalled()) return "shipflow-stop";
  return `node "${path.join(shipflowRoot, "hooks", "stop-verify.js")}"`;
}

function geminiGuardCommand() {
  if (isGloballyInstalled()) return "shipflow-gemini-guard";
  return `node "${path.join(shipflowRoot, "hooks", "gemini-guard.js")}"`;
}

function commandExists(cmd) {
  try {
    if (process.platform === "win32") {
      execSync(`where ${cmd}`, { stdio: "ignore" });
    } else {
      execSync(`command -v ${cmd}`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

function hasKiroCli(exists) {
  return exists("kiro-cli") || exists("kiro");
}

function hasActiveProviderSignal(env) {
  return Boolean(
    env.SHIPFLOW_ACTIVE_PROVIDER ||
    env.CODEX_THREAD_ID || env.CODEX_CI || env.CODEX_MANAGED_BY_NPM ||
    env.CLAUDECODE || env.CLAUDE_CODE || env.CLAUDE_SESSION_ID ||
    env.GEMINI_CLI || env.GEMINI_CLI_SESSION_ID ||
    env.KIRO_CLI || env.KIRO_SESSION_ID
  );
}

const BROWNFIELD_IGNORED = new Set([
  ".git",
  "node_modules",
  ".gen",
  ".shipflow",
  "evidence",
  "vp",
  "dist",
  "coverage",
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  "KIRO.md",
  "shipflow.json",
  ".gitignore",
]);

function hasMeaningfulRepoContent(dir) {
  if (!fs.existsSync(dir)) return false;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (BROWNFIELD_IGNORED.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isFile()) return true;
    if (ent.isDirectory() && hasMeaningfulRepoContent(full)) return true;
  }
  return false;
}

export function recommendedPlatforms(cwd, deps = {}) {
  const exists = deps.commandExists || commandExists;
  const env = deps.env || process.env;
  const activeProvider = resolveAutoProvider(cwd, { commandExists: exists, env });

  if (hasActiveProviderSignal(env) && ["claude", "codex", "gemini", "kiro"].includes(activeProvider)) {
    return [activeProvider];
  }

  const detected = [];
  if (exists("claude")) detected.push("claude");
  if (exists("codex")) detected.push("codex");
  if (exists("gemini")) detected.push("gemini");
  if (hasKiroCli(exists)) detected.push("kiro");

  return detected.length > 0 ? detected : ["claude"];
}

function writeIfMissing(filePath, content, created) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    created.push(path.relative(process.cwd(), filePath));
  }
}

function copyTemplate(name, destPath, created) {
  if (fs.existsSync(destPath)) return;
  const tmpl = fs.readFileSync(path.join(shipflowRoot, "templates", name), "utf-8");
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, tmpl);
  created.push(path.relative(process.cwd(), destPath));
}

function writeClaudeHooks(destPath, created) {
  const existedBefore = fs.existsSync(destPath);
  const requiredPreTool = [
    { matcher: "Bash", command: "shipflow-bash-guard" },
    { matcher: "Edit|Write", command: guardCommand() },
  ];
  const requiredStop = [{ command: stopCommand() }];

  const hooks = fs.existsSync(destPath)
    ? (() => {
        try {
          return JSON.parse(fs.readFileSync(destPath, "utf-8"));
        } catch {
          return { hooks: {} };
        }
      })()
    : { hooks: {} };

  if (!hooks.hooks) hooks.hooks = {};
  if (!Array.isArray(hooks.hooks.PreToolUse)) hooks.hooks.PreToolUse = [];
  if (!Array.isArray(hooks.hooks.Stop)) hooks.hooks.Stop = [];

  for (const hook of requiredPreTool) {
    if (!hooks.hooks.PreToolUse.some(existing => existing?.matcher === hook.matcher && existing?.command === hook.command)) {
      hooks.hooks.PreToolUse.push(hook);
    }
  }
  for (const hook of requiredStop) {
    if (!hooks.hooks.Stop.some(existing => existing?.command === hook.command)) {
      hooks.hooks.Stop.push(hook);
    }
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, JSON.stringify(hooks, null, 2) + "\n");
  created.push(path.relative(process.cwd(), destPath) + (existedBefore ? " (updated)" : ""));
}

function writeGeminiSettings(destPath, created) {
  if (fs.existsSync(destPath)) return;
  const settings = {
    hooks: {
      BeforeTool: [{
        matcher: "write_file|replace",
        hooks: [{
          name: "shipflow-guard",
          type: "command",
          command: geminiGuardCommand(),
          timeout: 5000
        }]
      }]
    }
  };
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, JSON.stringify(settings, null, 2) + "\n");
  created.push(path.relative(process.cwd(), destPath));
}

export function init({ cwd, platforms, deps = {} }) {
  const brownfieldRepo = hasMeaningfulRepoContent(cwd);
  const hadDraftSession = fs.existsSync(path.join(cwd, ".shipflow", "draft-session.json"));
  const selectedPlatforms = (platforms && platforms.length > 0)
    ? [...new Set(platforms)]
    : recommendedPlatforms(cwd, deps);
  const created = [];

  // VP directories (shared across all platforms)
  for (const sub of ["ui/_fixtures", "behavior", "api", "db", "nfr", "security", "technical", "policy"]) {
    const dir = path.join(cwd, "vp", sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  created.push("vp/");

  // shipflow.json (shared)
  writeIfMissing(path.join(cwd, "shipflow.json"), JSON.stringify({
    draft: {
      provider: "local",
      aiProvider: "auto",
    },
    impl: {
      provider: "auto",
      maxTokens: 16384,
      historyLimit: 50,
      srcDir: "src",
      context: "",
    },
  }, null, 2) + "\n", created);

  // .gitignore (shared)
  const giPath = path.join(cwd, ".gitignore");
  const giEntries = [".gen/", ".shipflow/", "evidence/"];
  if (fs.existsSync(giPath)) {
    const existing = fs.readFileSync(giPath, "utf-8");
    const missing = giEntries.filter(e => !existing.includes(e));
    if (missing.length > 0) {
      fs.appendFileSync(giPath, "\n# ShipFlow\n" + missing.join("\n") + "\n");
      created.push(".gitignore (appended)");
    }
  } else {
    fs.writeFileSync(giPath, "# ShipFlow\n" + giEntries.join("\n") + "\n");
    created.push(".gitignore");
  }

  // --- Platform-specific setup ---

  if (selectedPlatforms.includes("claude")) {
    copyTemplate("CLAUDE.md", path.join(cwd, "CLAUDE.md"), created);
    writeClaudeHooks(path.join(cwd, ".claude", "hooks.json"), created);
  }

  if (selectedPlatforms.includes("codex")) {
    copyTemplate("AGENTS.md", path.join(cwd, "AGENTS.md"), created);
    copyTemplate("codex-config.toml", path.join(cwd, ".codex", "config.toml"), created);
    copyTemplate("codex-rules.rules", path.join(cwd, ".codex", "rules", "shipflow.rules"), created);
  }

  if (selectedPlatforms.includes("gemini")) {
    copyTemplate("GEMINI.md", path.join(cwd, "GEMINI.md"), created);
    writeGeminiSettings(path.join(cwd, ".gemini", "settings.json"), created);
  }

  if (selectedPlatforms.includes("kiro")) {
    copyTemplate("KIRO.md", path.join(cwd, "KIRO.md"), created);
  }

  let discoverySummary = null;
  if (brownfieldRepo && !hadDraftSession) {
    const preview = buildDraft(cwd);
    const shouldSeedSession = preview.map?.project?.scanned_files > 0
      || preview.proposals.length > 0
      || preview.ambiguities.length > 0;
    if (shouldSeedSession) {
      const { result } = seedDraftSession(cwd);
      created.push(".shipflow/draft-session.json");
      discoverySummary = {
        proposals: result.proposals.length,
        types: [...new Set(result.proposals.map(proposal => proposal.type))],
        ambiguities: result.ambiguities.length,
      };
    }
  }

  // Summary
  const platformNames = selectedPlatforms.map(p =>
    p === "claude" ? "Claude Code" : p === "codex" ? "Codex CLI" : p === "gemini" ? "Gemini CLI" : "Kiro CLI"
  );
  console.log(green(`ShipFlow initialized for ${platformNames.join(" + ")}.`));
  for (const f of created) {
    console.log(dim(`  + ${f}`));
  }
  if (discoverySummary) {
    console.log(dim(`  Auto-discovery seeded ${discoverySummary.proposals} draft proposal(s) across ${discoverySummary.types.join(", ") || "no types"} for brownfield drafting.`));
    console.log(`\nNext: run shipflow draft to finalize the discovered verification candidates.`);
  } else {
    console.log(`\nNext: start the draft flow in your AI CLI, or run shipflow draft \"<what to build>\" directly.`);
  }
}
