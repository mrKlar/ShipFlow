import fs from "node:fs";
import path from "node:path";
import { listFilesRec } from "./util/fs.js";
import { sha256 } from "./util/hash.js";
import { green, red, yellow, bold, dim } from "./util/color.js";
import { loadManifest } from "./gen.js";

function countFiles(dir, ext) {
  if (!fs.existsSync(dir)) return 0;
  const yamlAlt = ext === ".yml" ? ".yaml" : null;
  return fs.readdirSync(dir).filter(f => f.endsWith(ext) || (yamlAlt && f.endsWith(yamlAlt))).length;
}

export function status({ cwd }) {
  const vpDir = path.join(cwd, "vp");
  const genDir = path.join(cwd, ".gen");
  const evidDir = path.join(cwd, "evidence");

  console.log(bold("ShipFlow Status\n"));

  // VP files
  const uiCount = countFiles(path.join(vpDir, "ui"), ".yml");
  const behaviorCount = countFiles(path.join(vpDir, "behavior"), ".yml");
  const apiCount = countFiles(path.join(vpDir, "api"), ".yml");
  const dbCount = countFiles(path.join(vpDir, "db"), ".yml");
  const nfrCount = countFiles(path.join(vpDir, "nfr"), ".yml");
  const securityCount = countFiles(path.join(vpDir, "security"), ".yml");
  const technicalCount = countFiles(path.join(vpDir, "technical"), ".yml");
  const fixtureCount = countFiles(path.join(vpDir, "ui", "_fixtures"), ".yml");
  const policyCount = fs.existsSync(path.join(vpDir, "policy"))
    ? fs.readdirSync(path.join(vpDir, "policy")).filter(f => f.endsWith(".rego")).length
    : 0;
  const totalVp = uiCount + behaviorCount + apiCount + dbCount + nfrCount + securityCount + technicalCount;

  if (totalVp === 0) {
    console.log(yellow("  vp/  (empty — run /shipflow-verifications to start)"));
  } else {
    console.log(bold("  Verifications:"));
    if (uiCount) console.log(`    UI:       ${uiCount} check(s)`);
    if (behaviorCount) console.log(`    Behavior: ${behaviorCount} check(s)`);
    if (apiCount) console.log(`    API:         ${apiCount} check(s)`);
    if (dbCount) console.log(`    Database:    ${dbCount} check(s)`);
    if (nfrCount) console.log(`    Performance: ${nfrCount} check(s)`);
    if (securityCount) console.log(`    Security:    ${securityCount} check(s)`);
    if (technicalCount) console.log(`    Technical:   ${technicalCount} check(s)`);
    if (fixtureCount) console.log(`    Fixtures: ${fixtureCount}`);
    if (policyCount) console.log(`    Policies: ${policyCount}`);
    console.log(dim(`    Total:    ${totalVp} verification(s)`));
  }
  console.log();

  // Generated tests
  const pwDir = path.join(genDir, "playwright");
  const k6Dir = path.join(genDir, "k6");
  const lockPath = path.join(genDir, "vp.lock.json");
  const manifest = loadManifest(cwd);
  const genCount = manifest
    ? Object.values(manifest.outputs || {})
      .filter(output => output.output_kind === "playwright")
      .reduce((total, output) => total + (output.count || 0), 0)
    : (fs.existsSync(pwDir) ? countFiles(pwDir, ".ts") : 0);
  const k6Count = manifest?.outputs?.nfr?.count ?? (fs.existsSync(k6Dir) ? countFiles(k6Dir, ".js") : 0);

  if (genCount === 0 && k6Count === 0) {
    console.log(yellow("  .gen/  (empty — run shipflow gen)"));
  } else {
    console.log(bold("  Generated:"));
    if (genCount) console.log(`    Playwright: ${genCount} test(s)`);
    if (k6Count) console.log(`    k6:         ${k6Count} script(s)`);
  }

  // Lock freshness
  if (fs.existsSync(lockPath) && fs.existsSync(vpDir)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
      const files = listFilesRec(vpDir).filter(p => !p.includes(`${path.sep}.DS_Store`));
      const items = files.map(p => {
        const rel = path.relative(cwd, p).replaceAll("\\", "/");
        const buf = fs.readFileSync(p);
        return { path: rel, sha256: sha256(buf) };
      }).sort((a, b) => a.path.localeCompare(b.path));
      const vpSha = sha256(Buffer.from(JSON.stringify(items)));
      if (vpSha === lock.vp_sha256) {
        console.log(green("    Lock: fresh ✓"));
      } else {
        console.log(red("    Lock: STALE — run shipflow gen"));
      }
    } catch {
      console.log(yellow("    Lock: unreadable"));
    }
  }
  console.log();

  // Evidence
  const runPath = path.join(evidDir, "run.json");
  const implementPath = path.join(evidDir, "implement.json");
  if (!fs.existsSync(runPath)) {
    console.log(yellow("  evidence/  (no runs yet — run shipflow verify)"));
  } else {
    try {
      const run = JSON.parse(fs.readFileSync(runPath, "utf-8"));
      console.log(bold("  Last run:"));
      console.log(`    Status:   ${run.ok ? green("PASS ✓") : red("FAIL ✗")}`);
      console.log(`    Duration: ${run.duration_ms}ms`);
      console.log(`    Date:     ${run.started_at}`);
      if (run.passed !== undefined) console.log(`    Passed:   ${run.passed}`);
      if (run.failed !== undefined) console.log(`    Failed:   ${run.failed}`);
      if (Array.isArray(run.groups) && run.groups.length > 0) {
        for (const group of run.groups) {
          const detail = group.skipped ? "skipped" : group.ok ? "pass" : "fail";
          console.log(`    ${group.label}: ${detail}`);
        }
      }
    } catch {
      console.log(yellow("  evidence/  (unreadable)"));
    }
  }
  if (fs.existsSync(implementPath)) {
    try {
      const implement = JSON.parse(fs.readFileSync(implementPath, "utf-8"));
      console.log(bold("  Last implement:"));
      console.log(`    Status:   ${implement.ok ? green("PASS ✓") : red("FAIL ✗")}`);
      console.log(`    Stage:    ${implement.stage}`);
      console.log(`    Iter:     ${implement.iterations}`);
      console.log(`    First:    ${implement.first_pass_success ? green("YES") : yellow("NO")}`);
    } catch {
      console.log(yellow("  implement evidence/  (unreadable)"));
    }
  }
  console.log();
}
