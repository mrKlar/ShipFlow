import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { green, dim } from "./util/color.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shipflowRoot = path.resolve(__dirname, "..");

function isGloballyInstalled() {
  try {
    const out = execSync("which shipflow-guard 2>/dev/null || where shipflow-guard 2>nul", { encoding: "utf-8" }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
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
  if (fs.existsSync(destPath)) return;
  const hooks = {
    hooks: {
      PreToolUse: [{ matcher: "Edit|Write", command: guardCommand() }],
      Stop: [{ command: stopCommand() }]
    }
  };
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, JSON.stringify(hooks, null, 2) + "\n");
  created.push(path.relative(process.cwd(), destPath));
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

export function init({ cwd, platforms = ["claude"] }) {
  const created = [];

  // VP directories (shared across all platforms)
  for (const sub of ["ui/_fixtures", "behavior", "api", "db", "nfr", "policy"]) {
    const dir = path.join(cwd, "vp", sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  created.push("vp/");

  // shipflow.json (shared)
  writeIfMissing(path.join(cwd, "shipflow.json"), JSON.stringify({
    impl: { srcDir: "src", context: "" }
  }, null, 2) + "\n", created);

  // .gitignore (shared)
  const giPath = path.join(cwd, ".gitignore");
  const giEntries = [".gen/", "evidence/"];
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

  if (platforms.includes("claude")) {
    copyTemplate("CLAUDE.md", path.join(cwd, "CLAUDE.md"), created);
    writeClaudeHooks(path.join(cwd, ".claude", "hooks.json"), created);
  }

  if (platforms.includes("codex")) {
    copyTemplate("AGENTS.md", path.join(cwd, "AGENTS.md"), created);
    copyTemplate("codex-config.toml", path.join(cwd, ".codex", "config.toml"), created);
    copyTemplate("codex-rules.rules", path.join(cwd, ".codex", "rules", "shipflow.rules"), created);
  }

  if (platforms.includes("gemini")) {
    copyTemplate("GEMINI.md", path.join(cwd, "GEMINI.md"), created);
    writeGeminiSettings(path.join(cwd, ".gemini", "settings.json"), created);
  }

  // Summary
  const platformNames = platforms.map(p =>
    p === "claude" ? "Claude Code" : p === "codex" ? "Codex CLI" : "Gemini CLI"
  );
  console.log(green(`ShipFlow initialized for ${platformNames.join(" + ")}.`));
  for (const f of created) {
    console.log(dim(`  + ${f}`));
  }
  console.log(`\nNext: describe what to build with your AI tool.`);
}
