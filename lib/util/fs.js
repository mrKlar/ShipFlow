import fs from "node:fs";
import path from "node:path";

export function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function listFilesRec(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRec(p));
    else out.push(p);
  }
  return out;
}

export function writeFile(p, content) {
  mkdirp(path.dirname(p));
  fs.writeFileSync(p, content, "utf-8");
}
