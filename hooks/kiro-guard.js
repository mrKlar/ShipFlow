#!/usr/bin/env node
// ShipFlow preToolUse hook for Kiro CLI — blocks writes to protected paths
// and shell detours that inspect installed ShipFlow internals.
// Kiro sends JSON via stdin with { tool_name, tool_input, ... }
// Exit 2 = block, stderr returned to LLM.

import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import {
  extractCommandFromHook,
  INTROSPECTION_BLOCK_MESSAGE,
  isShellTool,
  shouldBlockShipflowIntrospection,
} from "./introspection-common.js";

const PROTECTED = ["vp", ".gen", "evidence"];

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

if (isShellTool(input.tool_name || input.toolName)) {
  const command = extractCommandFromHook(input);
  if (shouldBlockShipflowIntrospection(command)) {
    process.stderr.write(INTROSPECTION_BLOCK_MESSAGE);
    process.exit(2);
  }
  process.exit(0);
}

const filePath = input.tool_input?.file_path || input.tool_input?.path || "";
if (!filePath) process.exit(0);

const rel = relative(process.cwd(), resolve(filePath)).replace(/\\/g, "/");
const blocked = PROTECTED.some(dir => rel === dir || rel.startsWith(dir + "/"));

if (blocked) {
  process.stderr.write(
    `BLOCKED by ShipFlow: cannot modify ${rel}\n` +
    `Protected paths: ${PROTECTED.join("/*, ")}/*\n` +
    `You can only modify files under src/. Fix the implementation, not the verifications or tests.\n`,
  );
  process.exit(2);
}
