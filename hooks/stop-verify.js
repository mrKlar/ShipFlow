#!/usr/bin/env node
// ShipFlow Stop hook — runs gen + verify before the AI can finish.
// If tests fail, exit non-zero to block completion.

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shipflow = resolve(__dirname, "..", "bin", "shipflow.js");

try {
  execFileSync("node", [shipflow, "gen"], { stdio: "inherit", cwd: process.cwd() });
} catch {
  process.stderr.write("ShipFlow Stop hook: gen failed. Fix VP files before completing.\n");
  process.exit(2);
}

try {
  execFileSync("node", [shipflow, "verify"], { stdio: "inherit", cwd: process.cwd() });
} catch {
  process.stderr.write(
    "\nShipFlow Stop hook: verification FAILED.\n" +
    "Tests must pass before the AI can complete. Fix the code and try again.\n"
  );
  process.exit(1);
}
