import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listFilesRec } from "./util/fs.js";
import { sha256 } from "./util/hash.js";
import { green, red, yellow, bold, dim } from "./util/color.js";
import { evaluatePolicy } from "./policy.js";

export function loadLock(cwd) {
  const lockPath = path.join(cwd, ".gen", "vp.lock.json");
  if (!fs.existsSync(lockPath)) throw new Error("Missing .gen/vp.lock.json. Run shipflow gen.");
  return JSON.parse(fs.readFileSync(lockPath, "utf-8"));
}

export function verifyLock(cwd, lock) {
  const vpDir = path.join(cwd, "vp");
  const files = listFilesRec(vpDir).filter(p => !p.includes(`${path.sep}.DS_Store`));
  const items = files.map(p => {
    const rel = path.relative(cwd, p).replaceAll("\\", "/");
    const buf = fs.readFileSync(p);
    return { path: rel, sha256: sha256(buf) };
  }).sort((a,b) => a.path.localeCompare(b.path));
  const vpSha = sha256(Buffer.from(JSON.stringify(items)));
  if (vpSha !== lock.vp_sha256) throw new Error("Verification pack changed since last generation. Run shipflow gen.");
}

export function parseSummary(output) {
  const passed = output.match(/(\d+)\s+passed/);
  const failed = output.match(/(\d+)\s+failed/);
  const skipped = output.match(/(\d+)\s+skipped/);
  return {
    passed: passed ? parseInt(passed[1], 10) : 0,
    failed: failed ? parseInt(failed[1], 10) : 0,
    skipped: skipped ? parseInt(skipped[1], 10) : 0,
  };
}

function ensureEvidence(cwd) {
  const evid = path.join(cwd, "evidence");
  fs.mkdirSync(evid, { recursive: true });
  fs.mkdirSync(path.join(evid, "artifacts"), { recursive: true });
  return evid;
}

export async function verify({ cwd, capture = false, verbose = false }) {
  const evid = ensureEvidence(cwd);
  const lock = loadLock(cwd);
  verifyLock(cwd, lock);

  // Policy gate
  const policyDir = path.join(cwd, "vp", "policy");
  if (fs.existsSync(policyDir) && fs.readdirSync(policyDir).some(f => f.endsWith(".rego"))) {
    console.log(bold("\nPolicy evaluation:"));
    const policy = evaluatePolicy({ cwd, lock });
    if (!policy.ok) {
      console.log(red("\nPolicy check FAILED. Fix policy violations before verifying.\n"));
      return { exitCode: 3, output: null };
    }
  }

  // NFR: run k6 scripts if present and k6 is available
  const k6Dir = path.join(cwd, ".gen", "k6");
  let nfrOk = true;
  let nfrOutput = "";
  if (fs.existsSync(k6Dir)) {
    const scripts = fs.readdirSync(k6Dir).filter(f => f.endsWith(".js"));
    if (scripts.length > 0) {
      const k6Check = spawnSync("k6", ["version"], { stdio: "pipe" });
      if (k6Check.status === 0) {
        console.log(bold(`\nNFR: running ${scripts.length} k6 script(s)...`));
        for (const script of scripts) {
          const r = spawnSync("k6", ["run", path.join(k6Dir, script)], { stdio: "pipe", cwd });
          const out = (r.stdout?.toString() || "") + (r.stderr?.toString() || "");
          nfrOutput += out;
          if (r.status !== 0) {
            nfrOk = false;
            console.log(red(`  ✗ ${script}`));
            if (verbose) process.stdout.write(out);
          } else {
            console.log(green(`  ✓ ${script}`));
          }
        }
      } else if (verbose) {
        console.log(dim("  k6 not found, skipping NFR checks"));
      }
    }
  }

  // Functional tests
  const t0 = Date.now();
  const res = spawnSync(
    "npx",
    ["playwright", "test", ".gen/playwright", "--reporter=list"],
    { stdio: "pipe", cwd },
  );
  const dt = Date.now() - t0;

  const output = (res.stdout?.toString() || "") + (res.stderr?.toString() || "");

  if (!capture) {
    process.stdout.write(output);
  }

  const summary = parseSummary(output);
  const ok = res.status === 0 && nfrOk;

  // Print summary
  const parts = [];
  if (summary.passed > 0) parts.push(green(`${summary.passed} passed`));
  if (summary.failed > 0) parts.push(red(`${summary.failed} failed`));
  if (summary.skipped > 0) parts.push(yellow(`${summary.skipped} skipped`));

  if (parts.length > 0) {
    console.log(`\n${bold("Summary:")} ${parts.join(", ")} ${dim(`(${dt}ms)`)}`);
  }

  if (ok) {
    console.log(green(bold("\n✓ All verifications passed.\n")));
  } else {
    console.log(red(bold("\n✗ Verifications failed.\n")));
  }

  const result = {
    version: 1,
    started_at: new Date(t0).toISOString(),
    duration_ms: dt,
    exit_code: ok ? 0 : (res.status ?? 1),
    ok,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
  };

  fs.writeFileSync(path.join(evid, "run.json"), JSON.stringify(result, null, 2));
  return { exitCode: result.exit_code, output };
}
