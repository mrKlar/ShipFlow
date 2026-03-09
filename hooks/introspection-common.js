function normalize(text) {
  return String(text || "").trim();
}

export function extractCommandFromHook(input) {
  const toolInput = input?.tool_input || input?.toolInput || input?.input || {};
  return normalize(
    toolInput.command
    || toolInput.cmd
    || toolInput.shell_command
    || toolInput.shellCommand
    || toolInput.bash_command
    || toolInput.bashCommand
    || toolInput.script
    || input?.command
    || "",
  );
}

export function isShellTool(toolName) {
  const name = normalize(toolName).toLowerCase();
  return name === "bash"
    || name === "shell"
    || name === "run_shell_command"
    || name === "execute_bash";
}

export function shouldBlockShipflowIntrospection(command) {
  const text = normalize(command);
  if (!text) return false;

  if (/^\s*(shipflow|~\/\.local\/bin\/shipflow|npx\s+--no-install\s+shipflow)\b/.test(text)) {
    return false;
  }

  const lowered = text.toLowerCase();
  const installMarkers = [
    "~/.local/bin/shipflow",
    "/.local/bin/shipflow",
    ".claude/plugins/cache/shipflow",
    "/.shipflow/",
    "shipflow_pkg=",
    "shipflow_dir=",
    "realpath ~/.local/bin/shipflow",
    "dirname $(realpath ~/.local/bin/shipflow)",
    "cat ~/.local/bin/shipflow",
    "head ~/.local/bin/shipflow",
    "readlink ~/.local/bin/shipflow",
  ];
  if (installMarkers.some(fragment => lowered.includes(fragment))) {
    return true;
  }

  const internalTargets = [
    "/examples/",
    "/templates/",
    "/docs/verification-pack.md",
    "/lib/schema/",
  ];

  if ((text.includes("$(") || text.includes("`"))
    && /(shipflow|examples\/|templates\/|verification-pack\.md|lib\/schema\/)/i.test(text)) {
    return true;
  }

  if (/(^|\s)(cat|head|sed|find|ls|grep|rg|readlink|realpath|dirname)\b/i.test(text)
    && internalTargets.some(fragment => lowered.includes(fragment))) {
    return true;
  }

  return false;
}

export const INTROSPECTION_BLOCK_MESSAGE =
  "BLOCKED by ShipFlow: do not inspect the installed ShipFlow package, examples, templates, or internal schema files.\n"
  + "Use `shipflow draft --json` as the source of truth, then `shipflow lint` and `shipflow gen`.\n"
  + "Read the current repo files directly with Read/Grep/Glob when product context is needed.\n";
