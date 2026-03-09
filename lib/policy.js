import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { red, green, bold } from "./util/color.js";
import { buildRuntimeEnv, runtimeCommandExists } from "./util/runtime-env.js";

export function findPolicies(cwd) {
  const dir = path.join(cwd, "vp", "policy");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".rego")).map(f => path.join(dir, f));
}

export function opaAvailable(cwdOrSpawn, maybeSpawn = spawnSync) {
  if (typeof cwdOrSpawn === "function") {
    const spawn = cwdOrSpawn;
    const r = spawn("opa", ["version"], { stdio: "pipe" });
    return r.status === 0;
  }
  return runtimeCommandExists(cwdOrSpawn, "opa", maybeSpawn);
}

export function evaluatePolicy({ cwd, lock }, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const policies = findPolicies(cwd);
  if (policies.length === 0) return { ok: true, skipped: true, results: [] };

  if (!opaAvailable(cwd, spawn)) {
    throw new Error(
      "OPA (Open Policy Agent) is required to evaluate vp/policy/*.rego files.\n" +
      "Install: https://www.openpolicyagent.org/docs/latest/#running-opa"
    );
  }

  const context = {
    vp_sha256: lock.vp_sha256,
    vp_files: lock.files.map(f => f.path),
    created_at: lock.created_at,
  };

  const inputPath = path.join(cwd, ".gen", "policy-input.json");
  fs.writeFileSync(inputPath, JSON.stringify(context, null, 2));

  const results = [];
  let allOk = true;

  for (const policy of policies) {
    const r = spawn("opa", [
      "eval",
      "--data", policy,
      "--input", inputPath,
      "--format", "json",
      "data.shipflow.deny",
    ], { stdio: "pipe", cwd, env: buildRuntimeEnv(cwd) });

    const output = r.stdout?.toString() || "";
    const policyName = path.basename(policy);

    try {
      const parsed = JSON.parse(output);
      const denials = parsed.result?.[0]?.expressions?.[0]?.value || [];
      if (denials.length > 0) {
        allOk = false;
        results.push({ policy: policyName, ok: false, denials });
        console.log(red(`  ✗ ${policyName}: ${denials.join(", ")}`));
      } else {
        results.push({ policy: policyName, ok: true, denials: [] });
        console.log(green(`  ✓ ${policyName}`));
      }
    } catch {
      allOk = false;
      const errMsg = r.stderr?.toString()?.trim() || "OPA evaluation error";
      results.push({ policy: policyName, ok: false, denials: [errMsg] });
      console.log(red(`  ✗ ${policyName}: ${errMsg}`));
    }
  }

  // Write policy evidence
  const evidencePath = path.join(cwd, "evidence", "policy.json");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify({ ok: allOk, results }, null, 2));

  // Clean up temp file
  try { fs.unlinkSync(inputPath); } catch {}

  return { ok: allOk, skipped: false, results };
}
