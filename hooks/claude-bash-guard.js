#!/usr/bin/env node
// ShipFlow Claude Bash guard — blocks Bash detours that inspect ShipFlow itself
// instead of using `shipflow draft`, `shipflow lint`, and `shipflow gen`.

import { readFileSync } from "node:fs";
import { evaluateClaudeBashGuard } from "./guard-runtime.js";

function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf-8"));
  } catch {
    return null;
  }
}

const input = readHookInput();
if (!input) process.exit(0);

const result = evaluateClaudeBashGuard(input);
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(result.stdout);
process.exit(result.code);
