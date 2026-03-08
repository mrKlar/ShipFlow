import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldenRoot = path.resolve(__dirname, "..", "golden");

const ISO_KEYS = new Set(["created_at", "started_at", "updated_at", "last_success_at", "last_failure_at"]);
const HASH_KEYS = new Set(["vp_sha256", "lock_vp_sha256", "sha256"]);
const NUMBER_KEYS = new Set(["duration_ms", "average_duration_ms"]);

function normalizeValue(key, value) {
  if (ISO_KEYS.has(key) && typeof value === "string") return "<iso>";
  if (HASH_KEYS.has(key) && typeof value === "string") return `<${key}>`;
  if (NUMBER_KEYS.has(key) && typeof value === "number") return 0;
  return value;
}

export function normalizeGoldenJson(value) {
  return JSON.parse(JSON.stringify(value, (key, currentValue) => normalizeValue(key, currentValue)));
}

export function readGolden(relPath) {
  return fs.readFileSync(path.join(goldenRoot, relPath), "utf-8");
}

export function assertGolden(relPath, actual) {
  assert.equal(actual, readGolden(relPath));
}
