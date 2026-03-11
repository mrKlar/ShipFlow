import path from "node:path";
import { spawnSync } from "node:child_process";
import { gen, loadManifest } from "./gen.js";
import { readUiChecks } from "./gen-ui.js";
import { buildRuntimeEnv } from "./util/runtime-env.js";

function generatedPlaywrightConfigPath(cwd) {
  const rel = ".gen/playwright.config.mjs";
  return rel;
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function resolveSelectedVisualChecks(cwd, checks, input) {
  const query = String(input || "").trim();
  if (!query) return checks;

  const absolute = normalizePath(path.resolve(cwd, query));
  const relative = normalizePath(path.relative(cwd, absolute));
  const basename = path.basename(query);

  const matches = checks.filter(check => {
    const file = normalizePath(check.__file || "");
    const absFile = normalizePath(path.resolve(cwd, file));
    return check.id === query
      || file === query
      || file === relative
      || absFile === absolute
      || path.basename(file) === basename;
  });

  if (matches.length === 0) {
    throw new Error(`No visual UI verification found for "${query}".`);
  }

  return matches;
}

function manifestUiFilesByCheckId(manifest) {
  const checks = manifest?.outputs?.ui?.checks || [];
  return new Map(
    checks
      .filter(check => typeof check?.id === "string" && typeof check?.file === "string")
      .map(check => [check.id, check.file]),
  );
}

export async function approveVisual({ cwd, input = "" }) {
  await gen({ cwd });

  const manifest = loadManifest(cwd);
  if (!manifest?.outputs?.ui) {
    console.log("ShipFlow approve-visual: no generated UI checks.");
    return { exitCode: 0 };
  }

  const vpDir = path.join(cwd, "vp");
  const allVisualChecks = readUiChecks(vpDir).filter(check => (check.visual?.snapshots?.length || 0) > 0);
  const selectedChecks = resolveSelectedVisualChecks(cwd, allVisualChecks, input);
  if (selectedChecks.length === 0) {
    console.log("ShipFlow approve-visual: no UI visual snapshots to approve.");
    return { exitCode: 0 };
  }

  const filesById = manifestUiFilesByCheckId(manifest);
  const files = selectedChecks
    .map(check => filesById.get(check.id))
    .filter(Boolean);

  if (files.length === 0) {
    throw new Error("Generated UI tests for visual checks are missing from .gen/manifest.json. Run shipflow gen.");
  }

  const config = generatedPlaywrightConfigPath(cwd);
  const args = ["playwright", "test", "--config", config, "--reporter=list", ...files];
  const result = spawnSync("npx", args, {
    cwd,
    stdio: "inherit",
    env: buildRuntimeEnv(cwd, process.env, {
      SHIPFLOW_APPROVE_VISUAL: "1",
      SHIPFLOW_EVIDENCE_DIR: path.join(cwd, "evidence"),
    }),
  });

  if ((result.status ?? 1) !== 0) {
    return { exitCode: result.status ?? 1 };
  }

  await gen({ cwd });
  console.log(`ShipFlow approve-visual: approved ${selectedChecks.length} visual UI check(s).`);
  return { exitCode: 0 };
}
