import { resolve, relative } from "node:path";
import {
  extractCommandFromHook,
  INTROSPECTION_BLOCK_MESSAGE,
  isShellTool,
  shouldBlockShipflowIntrospection,
} from "./introspection-common.js";

const PROTECTED = ["vp", ".gen", "evidence"];

function isProtectedPath(filePath, cwd = process.cwd()) {
  const rel = relative(cwd, resolve(filePath)).replace(/\\/g, "/");
  return PROTECTED.some(dir => rel === dir || rel.startsWith(dir + "/")) ? rel : null;
}

function blockedWriteMessage(rel) {
  return `BLOCKED by ShipFlow: cannot modify ${rel}\n`
    + `Protected paths: ${PROTECTED.join("/*, ")}/*\n`
    + "You can only modify files under src/. Fix the implementation, not the verifications or tests.\n";
}

export function evaluateClaudeBashGuard(input) {
  const command = extractCommandFromHook(input);
  if (!shouldBlockShipflowIntrospection(command)) {
    return { code: 0, stdout: "", stderr: "" };
  }

  return { code: 2, stdout: "", stderr: INTROSPECTION_BLOCK_MESSAGE };
}

export function evaluateGeminiGuard(input, { cwd = process.cwd() } = {}) {
  if (isShellTool(input?.tool_name || input?.toolName)) {
    const command = extractCommandFromHook(input);
    if (shouldBlockShipflowIntrospection(command)) {
      return { code: 2, stdout: "", stderr: INTROSPECTION_BLOCK_MESSAGE };
    }

    return { code: 0, stdout: JSON.stringify({ decision: "allow" }), stderr: "" };
  }

  const filePath = input?.tool_input?.file_path || input?.tool_input?.path || "";
  if (!filePath) {
    return { code: 0, stdout: JSON.stringify({ decision: "allow" }), stderr: "" };
  }

  const blockedRel = isProtectedPath(filePath, cwd);
  if (blockedRel) {
    return { code: 2, stdout: "", stderr: blockedWriteMessage(blockedRel) };
  }

  return { code: 0, stdout: JSON.stringify({ decision: "allow" }), stderr: "" };
}

export function evaluateKiroGuard(input, { cwd = process.cwd() } = {}) {
  if (isShellTool(input?.tool_name || input?.toolName)) {
    const command = extractCommandFromHook(input);
    if (shouldBlockShipflowIntrospection(command)) {
      return { code: 2, stdout: "", stderr: INTROSPECTION_BLOCK_MESSAGE };
    }

    return { code: 0, stdout: "", stderr: "" };
  }

  const filePath = input?.tool_input?.file_path || input?.tool_input?.path || "";
  if (!filePath) {
    return { code: 0, stdout: "", stderr: "" };
  }

  const blockedRel = isProtectedPath(filePath, cwd);
  if (blockedRel) {
    return { code: 2, stdout: "", stderr: blockedWriteMessage(blockedRel) };
  }

  return { code: 0, stdout: "", stderr: "" };
}
