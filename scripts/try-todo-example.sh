#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE_DIR="$ROOT_DIR/examples/todo-app"

# Colors
if [ -t 1 ]; then
  B="\033[1m" Y="\033[33m" R="\033[0m"
else
  B="" Y="" R=""
fi

cat <<EOF

${B}TRY ME — ShipFlow canonical demo${R}

This script will:
  1. Install ShipFlow (if not already installed)
  2. cd into examples/todo-app
  3. Delete src/ (the implementation) — only the verification pack stays
  4. Run \`shipflow implement\` — the AI rebuilds the app from the locked pack

${Y}Heads up:${R}
  - Step 4 invokes a real LLM via your configured AI CLI (Claude Code,
    Codex, Gemini, or Kiro — whichever the installer detected).
  - Expect 5–15 minutes of wall time and several thousand tokens of
    LLM budget. The bounded loop stops after 5 verification iterations
    even if it does not converge.
  - You can cancel any time with Ctrl-C; partial state lives under
    \`.shipflow/\` and \`evidence/\` for inspection.

Set ${B}SHIPFLOW_TRY_SKIP_PROMPT=1${R} to skip this notice in CI.

EOF

if [ "${SHIPFLOW_TRY_SKIP_PROMPT:-}" != "1" ] && [ -t 0 ]; then
  printf "Press Enter to continue, or Ctrl-C to abort... "
  read -r _
  echo
fi

"$ROOT_DIR/install.sh"

SHIPFLOW_BIN="$(command -v shipflow || true)"
if [ -z "$SHIPFLOW_BIN" ]; then
  GLOBAL_NPM_BIN="$(npm prefix -g)/bin/shipflow"
  if [ -x "$GLOBAL_NPM_BIN" ]; then
    SHIPFLOW_BIN="$GLOBAL_NPM_BIN"
  elif [ -x "$HOME/.local/bin/shipflow" ]; then
    SHIPFLOW_BIN="$HOME/.local/bin/shipflow"
  else
    printf "Could not locate the installed 'shipflow' command after running install.sh.\n" >&2
    exit 1
  fi
fi

cd "$EXAMPLE_DIR"
npm install
rm -rf src
mkdir -p src
touch src/.gitkeep

"$SHIPFLOW_BIN" implement
