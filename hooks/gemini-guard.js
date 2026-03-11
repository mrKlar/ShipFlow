#!/usr/bin/env node
// ShipFlow BeforeTool hook for Gemini CLI — blocks writes to protected paths
// and shell detours that inspect installed ShipFlow internals.
//
// Gemini CLI sends JSON on stdin with tool_name and tool_input.
// Exit 0 with {"decision":"allow"} to proceed.
// Exit 2 to block the operation.

import { readFileSync } from "node:fs";
import { evaluateGeminiGuard } from "./guard-runtime.js";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  // Cannot parse input — allow by default
  process.stdout.write(JSON.stringify({ decision: "allow" }));
  process.exit(0);
}

const result = evaluateGeminiGuard(input);
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(result.stdout);
process.exit(result.code);
