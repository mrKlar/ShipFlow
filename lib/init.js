import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { green, dim } from "./util/color.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shipflowRoot = path.resolve(__dirname, "..");

function relativeShipflow(cwd) {
  try {
    return path.relative(cwd, shipflowRoot).replaceAll("\\", "/");
  } catch {
    return shipflowRoot;
  }
}

function writeIfMissing(filePath, content, created) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    created.push(path.relative(process.cwd(), filePath));
  }
}

function copyTemplate(name, destPath, rel, created) {
  if (fs.existsSync(destPath)) return;
  const tmpl = fs.readFileSync(path.join(shipflowRoot, "templates", name), "utf-8");
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, tmpl.replaceAll("tools/shipflow", rel));
  created.push(path.relative(process.cwd(), destPath));
}

export function init({ cwd, platforms = ["claude"] }) {
  const rel = relativeShipflow(cwd);
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
    copyTemplate("CLAUDE.md", path.join(cwd, "CLAUDE.md"), rel, created);
    copyTemplate("claude-hooks.json", path.join(cwd, ".claude", "hooks.json"), rel, created);
  }

  if (platforms.includes("codex")) {
    copyTemplate("AGENTS.md", path.join(cwd, "AGENTS.md"), rel, created);
    copyTemplate("codex-config.toml", path.join(cwd, ".codex", "config.toml"), rel, created);
    copyTemplate("codex-rules.rules", path.join(cwd, ".codex", "rules", "shipflow.rules"), rel, created);
  }

  if (platforms.includes("gemini")) {
    copyTemplate("GEMINI.md", path.join(cwd, "GEMINI.md"), rel, created);
    copyTemplate("gemini-settings.json", path.join(cwd, ".gemini", "settings.json"), rel, created);
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
