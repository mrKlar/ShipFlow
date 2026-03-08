import fs from "node:fs";
import path from "node:path";
import { listFilesRec } from "./fs.js";
import { sha256 } from "./hash.js";

export function computeVerificationPackSnapshot(cwd) {
  const vpDir = path.join(cwd, "vp");
  if (!fs.existsSync(vpDir)) {
    const files = [];
    return {
      files,
      vp_sha256: sha256(Buffer.from(JSON.stringify(files))),
    };
  }

  const files = listFilesRec(vpDir)
    .filter(file => !file.includes(`${path.sep}.DS_Store`))
    .filter(file => /\.(yml|yaml|rego)$/i.test(file))
    .map(file => {
      const relPath = path.relative(cwd, file).replaceAll("\\", "/");
      return {
        path: relPath,
        sha256: sha256(fs.readFileSync(file)),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    files,
    vp_sha256: sha256(Buffer.from(JSON.stringify(files))),
  };
}

export function diffVerificationPackSnapshots(previousSnapshot, currentSnapshot) {
  const previous = new Map((previousSnapshot?.files || []).map(item => [item.path, item.sha256]));
  const current = new Map((currentSnapshot?.files || []).map(item => [item.path, item.sha256]));
  const paths = new Set([...previous.keys(), ...current.keys()]);

  return [...paths]
    .filter(item => previous.get(item) !== current.get(item))
    .sort((a, b) => a.localeCompare(b));
}
