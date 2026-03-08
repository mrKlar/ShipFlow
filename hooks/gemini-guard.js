#!/usr/bin/env node
// ShipFlow BeforeTool hook for Gemini CLI — blocks writes to protected paths.
//
// Gemini CLI sends JSON on stdin with tool_name and tool_input.
// Exit 0 with {"decision":"allow"} to proceed.
// Exit 2 to block the operation.

import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const PROTECTED = ["vp", ".gen", "evidence"];

let input;
try {
  input = JSON.parse(readFileSync("/dev/stdin", "utf-8"));
} catch {
  // Cannot parse input — allow by default
  process.stdout.write(JSON.stringify({ decision: "allow" }));
  process.exit(0);
}

const filePath = input.tool_input?.file_path || input.tool_input?.path || "";
if (!filePath) {
  process.stdout.write(JSON.stringify({ decision: "allow" }));
  process.exit(0);
}

const rel = relative(process.cwd(), resolve(filePath)).replace(/\\/g, "/");
const blocked = PROTECTED.some(dir => rel === dir || rel.startsWith(dir + "/"));

if (blocked) {
  process.stderr.write(
    `BLOCKED by ShipFlow: cannot modify ${rel}\n` +
    `Protected paths: ${PROTECTED.join("/*, ")}/*\n` +
    `You can only modify files under src/. Fix the implementation, not the verifications or tests.\n`
  );
  process.exit(2);
}

process.stdout.write(JSON.stringify({ decision: "allow" }));
process.exit(0);
