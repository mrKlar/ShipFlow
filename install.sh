#!/usr/bin/env bash
set -euo pipefail

SHIPFLOW_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== ShipFlow Installer ==="
echo ""

# --- 1. Install npm dependencies ---
echo "[1/4] Installing dependencies..."
npm install --prefix "$SHIPFLOW_DIR" --omit=dev 2>/dev/null
echo "  OK"

# --- 2. Create global 'shipflow' command ---
echo "[2/4] Creating global shipflow command..."
npm link --prefix "$SHIPFLOW_DIR" 2>/dev/null
echo "  OK — $(which shipflow 2>/dev/null || echo 'shipflow linked')"

# --- 3. Register ShipFlow as a Claude Code plugin marketplace ---
echo "[3/4] Installing Claude Code plugin..."

if command -v claude &>/dev/null; then
  # Remove old symlink-based install if present
  OLD_PLUGIN="$HOME/.claude/plugins/marketplaces/local/plugins/shipflow"
  if [ -L "$OLD_PLUGIN" ] || [ -d "$OLD_PLUGIN" ]; then
    rm -rf "$OLD_PLUGIN"
  fi

  # Register marketplace (remove first if already registered, then re-add)
  claude plugin marketplace remove shipflow 2>/dev/null || true
  claude plugin marketplace add "$SHIPFLOW_DIR"
  echo "  Registered ShipFlow marketplace"

  # Install the plugin (uninstall first for clean update)
  claude plugin uninstall shipflow@shipflow 2>/dev/null || true
  claude plugin install shipflow@shipflow 2>/dev/null || true
  echo "  OK"
else
  echo "  Claude Code not found — skipping plugin install"
  echo "  (You can still use: shipflow init --claude)"
fi

# --- 4. Setup project (optional) ---
echo "[4/4] Project setup..."
PROJECT_DIR="${1:-}"

if [ -n "$PROJECT_DIR" ]; then
  PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

  # Parse platform flags
  PLATFORMS=""
  shift || true
  for arg in "$@"; do
    case "$arg" in
      --claude) PLATFORMS="$PLATFORMS --claude" ;;
      --codex)  PLATFORMS="$PLATFORMS --codex" ;;
      --gemini) PLATFORMS="$PLATFORMS --gemini" ;;
    esac
  done

  (cd "$PROJECT_DIR" && shipflow init $PLATFORMS)
else
  echo "  No project specified."
  echo ""
  echo "  To setup a project:"
  echo "    cd /path/to/your-app"
  echo "    shipflow init                  # Claude Code (default)"
  echo "    shipflow init --codex          # Codex CLI"
  echo "    shipflow init --gemini         # Gemini CLI"
  echo "    shipflow init --claude --codex # Multiple platforms"
fi

echo ""
echo "=== ShipFlow installed ==="
