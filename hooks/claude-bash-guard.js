#!/usr/bin/env node
// ShipFlow Claude Bash guard — blocks Bash detours that inspect ShipFlow itself
// instead of using `shipflow draft`, `shipflow lint`, and `shipflow gen`.

import { readFileSync } from "node:fs";

function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf-8"));
  } catch {
    return null;
  }
}

function normalizeCommand(input) {
  return String(
    input?.tool_input?.command
    || input?.input?.command
    || input?.toolInput?.command
    || input?.command
    || "",
  );
}

function shouldBlock(command) {
  const text = String(command || "");
  if (!text.trim()) return false;

  const lowered = text.toLowerCase();

  // Explicitly allow ShipFlow CLI entrypoints.
  if (/^\s*(shipflow|~\/\.local\/bin\/shipflow|npx\s+--no-install\s+shipflow)\b/.test(text)) {
    return false;
  }

  // Block introspection of the installed ShipFlow package, examples, templates, and docs.
  const shipflowIntrospection = [
    "~/.local/bin/shipflow",
    ".claude/plugins/cache/shipflow",
    "/examples/",
    "/templates/",
    "/docs/verification-pack.md",
    "/lib/schema/",
    "shipflow_pkg=",
    "realpath ~/.local/bin/shipflow",
    "dirname $(realpath ~/.local/bin/shipflow)",
    "cat ~/.local/bin/shipflow",
    "find ~/.local/share",
    "find ~/.local/lib",
    "find ~/.npm",
  ];

  if (shipflowIntrospection.some(fragment => lowered.includes(fragment))) {
    return true;
  }

  // Also block common shell-command-substitution patterns when they are used to locate ShipFlow internals.
  if ((text.includes("$(") || text.includes("`"))
    && /(shipflow|examples\/|templates\/|verification-pack\.md|lib\/schema\/)/i.test(text)) {
    return true;
  }

  return false;
}

const input = readHookInput();
if (!input) process.exit(0);

const command = normalizeCommand(input);
if (!shouldBlock(command)) process.exit(0);

process.stderr.write(
  "BLOCKED by ShipFlow: do not inspect the installed ShipFlow package, examples, templates, or internal schema files from Bash.\n"
  + "Use `shipflow draft --json` as the source of truth, then `shipflow lint` and `shipflow gen`.\n"
  + "Read the current repo files directly with Read/Grep/Glob when product context is needed.\n",
);
process.exit(2);
