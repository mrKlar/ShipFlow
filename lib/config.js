import fs from "node:fs";
import path from "node:path";

export function readConfig(cwd) {
  const p = path.join(cwd, "shipflow.json");
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}
