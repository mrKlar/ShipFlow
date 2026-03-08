import fs from "node:fs";
import path from "node:path";
import { listFilesRec } from "./util/fs.js";
import { readConfig } from "./config.js";
import { generateWithProvider, resolveProviderModel, resolveProviderName } from "./providers/index.js";

export { readConfig } from "./config.js";

function collectFiles(dir, cwd) {
  if (!fs.existsSync(dir)) return [];
  return listFilesRec(dir)
    .filter(p => !p.includes("node_modules") && !p.includes(".DS_Store"))
    .map(p => ({
      path: path.relative(cwd, p).replaceAll("\\", "/"),
      content: fs.readFileSync(p, "utf-8"),
    }));
}

export function buildPrompt(vpFiles, genFiles, srcFiles, config, errors) {
  const srcDir = config.impl?.srcDir || "src";
  const lines = [];

  lines.push(`You are implementing an application from a ShipFlow verification pack.
The Verification Pack (YAML) defines the required behavior and constraints.
Generated tests and scripts define exactly how the project will be verified.

Rules:
- Only create or modify files under "${srcDir}/".
- Do NOT modify vp/, .gen/, evidence/, package.json, or playwright.config.ts.
- Pay close attention to data-testid attributes, label text, aria roles, button text, and URL patterns in the tests.
- Respect API contracts, database assertions, security checks, technical constraints, and performance budgets described in the pack.
- Make the project fully functional so all generated verification checks pass.
- Return complete, working code — no placeholders or TODOs.`);

  if (config.impl?.context) {
    lines.push(`\n## Project Context\n${config.impl.context}`);
  }

  lines.push("\n## Verifications");
  for (const f of vpFiles) {
    lines.push(`\n### ${f.path}\n\`\`\`yaml\n${f.content}\`\`\``);
  }

  if (genFiles.length > 0) {
    lines.push("\n## Generated Playwright Tests (these will be executed)");
    for (const f of genFiles) {
      lines.push(`\n### ${f.path}\n\`\`\`typescript\n${f.content}\`\`\``);
    }
  }

  if (srcFiles.length > 0) {
    lines.push("\n## Current Source Code");
    for (const f of srcFiles) {
      lines.push(`\n### ${f.path}\n\`\`\`\n${f.content}\`\`\``);
    }
  }

  if (errors) {
    const truncated = errors.length > 8000 ? errors.slice(-8000) : errors;
    lines.push(`\n## Test Failures — Fix These\n\`\`\`\n${truncated}\`\`\``);
  }

  lines.push(`\n## Output Format
Return ALL files needed using this exact format for each file:

--- FILE: ${srcDir}/path/to/file ---
file content here
--- END FILE ---

Only include files you want ShipFlow to write or overwrite. Omitted files are preserved.`);

  return lines.join("\n");
}

export function parseFiles(text) {
  const files = [];
  const regex = /--- FILE: (.+?) ---\n([\s\S]*?)--- END FILE ---/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    files.push({ path: match[1].trim(), content: match[2] });
  }
  return files;
}

export function resolveImplOptions(cwd, overrides = {}, deps = {}) {
  const config = readConfig(cwd);
  const configuredProvider = overrides.provider || process.env.SHIPFLOW_IMPL_PROVIDER || config.impl?.provider || "auto";
  const provider = resolveProviderName(configuredProvider, cwd, deps);
  const model = resolveProviderModel(config.impl, provider, {
    model: overrides.model,
    envModel: process.env.SHIPFLOW_IMPL_MODEL,
    legacyModel: typeof config.models?.impl === "string" ? config.models.impl : null,
  });
  const maxTokens = config.impl?.maxTokens || 16384;
  const srcDir = config.impl?.srcDir || "src";
  const providerOptions = provider === "command"
    ? { command: config.impl?.command || null }
    : {};
  return { config, provider, model, maxTokens, srcDir, providerOptions, configuredProvider };
}

export async function impl({ cwd, errors, provider, model }) {
  const { config, provider: resolvedProvider, model: resolvedModel, maxTokens, srcDir, providerOptions } = resolveImplOptions(cwd, { provider, model });

  const vpFiles = collectFiles(path.join(cwd, "vp"), cwd);
  const genFiles = collectFiles(path.join(cwd, ".gen"), cwd)
    .filter(f => f.path.endsWith(".test.ts") || f.path.endsWith(".test.js"));
  const srcFiles = collectFiles(path.join(cwd, srcDir), cwd);

  const prompt = buildPrompt(vpFiles, genFiles, srcFiles, config, errors);
  console.log(`ShipFlow impl: calling provider=${resolvedProvider}${resolvedModel ? ` model=${resolvedModel}` : ""}...`);
  const text = await generateWithProvider({
    provider: resolvedProvider,
    model: resolvedModel,
    maxTokens,
    prompt,
    cwd,
    options: providerOptions,
  });

  const files = parseFiles(text);
  if (files.length === 0) {
    throw new Error("ShipFlow impl: AI returned no files.\n" + text.slice(0, 1000));
  }

  // Only allow files under srcDir
  const allowed = files.filter(f => f.path.startsWith(srcDir + "/"));
  const rejected = files.filter(f => !f.path.startsWith(srcDir + "/"));
  if (rejected.length > 0) {
    console.warn(
      `ShipFlow impl: rejected ${rejected.length} file(s) outside ${srcDir}/: ` +
      rejected.map(f => f.path).join(", ")
    );
  }

  for (const file of allowed) {
    const fullPath = path.join(cwd, file.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content, "utf-8");
  }

  console.log(`ShipFlow impl: wrote ${allowed.length} file(s) → ${allowed.map(f => f.path).join(", ")}`);
  return allowed.map(f => f.path);
}
