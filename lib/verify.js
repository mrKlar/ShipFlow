import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listFilesRec } from "./util/fs.js";
import { sha256 } from "./util/hash.js";

function loadLock(cwd) {
  const lockPath = path.join(cwd, ".gen", "vp.lock.json");
  if (!fs.existsSync(lockPath)) throw new Error("Missing .gen/vp.lock.json. Run shipflow gen.");
  return JSON.parse(fs.readFileSync(lockPath, "utf-8"));
}

function verifyLock(cwd, lock) {
  const vpDir = path.join(cwd, "vp");
  const files = listFilesRec(vpDir).filter(p => !p.includes(`${path.sep}.DS_Store`));
  const items = files.map(p => {
    const rel = path.relative(cwd, p).replaceAll("\\", "/");
    const buf = fs.readFileSync(p);
    return { path: rel, sha256: sha256(buf) };
  }).sort((a,b) => a.path.localeCompare(b.path));
  const vpSha = sha256(Buffer.from(JSON.stringify(items)));
  if (vpSha !== lock.vp_sha256) throw new Error("VP changed since last generation. Run shipflow gen.");
}

function ensureEvidence(cwd) {
  const evid = path.join(cwd, "evidence");
  fs.mkdirSync(evid, { recursive: true });
  fs.mkdirSync(path.join(evid, "artifacts"), { recursive: true });
  return evid;
}

export async function verify({ cwd }) {
  const evid = ensureEvidence(cwd);
  const lock = loadLock(cwd);
  verifyLock(cwd, lock);

  // v1: policy gate integration point (OPA) — not executed here to keep framework self-contained.
  // Adapters/CI can run `opa eval` and block before calling shipflow verify.

  const t0 = Date.now();
  const res = spawnSync("npx", ["playwright", "test", ".gen/playwright", "--reporter=list"], { stdio: "inherit", cwd });
  const dt = Date.now() - t0;

  const run = {
    version: 1,
    started_at: new Date(t0).toISOString(),
    duration_ms: dt,
    exit_code: res.status ?? 1,
    ok: res.status === 0
  };

  fs.writeFileSync(path.join(evid, "run.json"), JSON.stringify(run, null, 2));
  return run.exit_code;
}
