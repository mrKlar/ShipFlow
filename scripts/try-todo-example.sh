#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE_DIR="$ROOT_DIR/examples/todo-app"

printf "\nTRY ME! ShipFlow will install itself, reset the canonical todo app example, and run the normal implementation loop.\n\n"

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
