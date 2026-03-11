#!/usr/bin/env node
// ShipFlow preToolUse hook for Kiro CLI — blocks writes to protected paths
// and shell detours that inspect installed ShipFlow internals.
// Kiro sends JSON via stdin with { tool_name, tool_input, ... }
// Exit 2 = block, stderr returned to LLM.

import { readFileSync } from "node:fs";
import { evaluateKiroGuard } from "./guard-runtime.js";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

const result = evaluateKiroGuard(input);
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(result.stdout);
process.exit(result.code);
