import fs from "node:fs";
import path from "node:path";
import { listFilesRec } from "./fs.js";
import { sha256 } from "./hash.js";

function normalizedItems(cwd, files) {
  return files.map(file => {
    const rel = path.relative(cwd, file).replaceAll("\\", "/");
    return {
      path: rel,
      sha256: sha256(fs.readFileSync(file)),
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

export function collectVerificationPackItems(cwd, vpDir = path.join(cwd, "vp")) {
  const files = fs.existsSync(vpDir)
    ? listFilesRec(vpDir).filter(file => !file.includes(`${path.sep}.DS_Store`))
    : [];
  return normalizedItems(cwd, files);
}

export function collectGeneratedArtifactItems(cwd, genDir = path.join(cwd, ".gen")) {
  const lockPath = path.join(genDir, "vp.lock.json");
  const files = fs.existsSync(genDir)
    ? listFilesRec(genDir).filter(file => file !== lockPath && !file.includes(`${path.sep}.DS_Store`))
    : [];
  return normalizedItems(cwd, files);
}

export function hashLockItems(items) {
  return sha256(Buffer.from(JSON.stringify(items)));
}

export function buildVerificationLock(cwd, { vpDir = path.join(cwd, "vp"), genDir = path.join(cwd, ".gen"), createdAt = new Date().toISOString() } = {}) {
  const packFiles = collectVerificationPackItems(cwd, vpDir);
  const generatedFiles = collectGeneratedArtifactItems(cwd, genDir);
  return {
    version: 2,
    created_at: createdAt,
    vp_sha256: hashLockItems(packFiles),
    files: packFiles,
    generated_sha256: hashLockItems(generatedFiles),
    generated_files: generatedFiles,
  };
}
