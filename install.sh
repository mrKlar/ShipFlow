#!/usr/bin/env bash
set -euo pipefail

SHIPFLOW_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== ShipFlow Installer ==="
echo ""

# --- 1. Install npm dependencies ---
echo "[1/3] Installing dependencies..."
npm install --prefix "$SHIPFLOW_DIR" --omit=dev 2>/dev/null
echo "  OK"

# --- 2. Register ShipFlow as a Claude Code plugin marketplace ---
echo "[2/3] Installing Claude Code plugin..."

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

# --- 3. Setup project (optional) ---
echo "[3/3] Project setup..."
PROJECT_DIR="${1:-}"

if [ -n "$PROJECT_DIR" ]; then
  PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
  REL_PATH="$(python3 -c "import os; print(os.path.relpath('$SHIPFLOW_DIR', '$PROJECT_DIR'))" 2>/dev/null || echo "$SHIPFLOW_DIR")"

  # CLAUDE.md
  if [ ! -f "$PROJECT_DIR/CLAUDE.md" ]; then
    sed "s|tools/shipflow|$REL_PATH|g" "$SHIPFLOW_DIR/templates/CLAUDE.md" > "$PROJECT_DIR/CLAUDE.md"
    echo "  Created CLAUDE.md"
  else
    echo "  CLAUDE.md already exists, skipped"
  fi

  # Hooks
  mkdir -p "$PROJECT_DIR/.claude"
  if [ ! -f "$PROJECT_DIR/.claude/hooks.json" ]; then
    sed "s|tools/shipflow|$REL_PATH|g" "$SHIPFLOW_DIR/templates/claude-hooks.json" > "$PROJECT_DIR/.claude/hooks.json"
    echo "  Created .claude/hooks.json"
  else
    echo "  .claude/hooks.json already exists, skipped"
  fi

  # VP scaffold
  mkdir -p "$PROJECT_DIR/vp/ui/_fixtures"
  echo "  Created vp/"

  echo ""
  echo "Done. Restart claude and use:"
  echo "  /shipflow-verifications   — define verifications with AI"
  echo "  /shipflow-impl   — AI implements and verifies"
else
  echo "  No project specified."
  echo ""
  echo "  To setup a project:"
  echo "    $SHIPFLOW_DIR/install.sh /path/to/your-app"
  echo ""
  echo "  Or just open any project with claude — the plugin is globally available."
  echo "  Restart claude, then use:"
  echo "    /shipflow-verifications"
  echo "    /shipflow-impl"
fi

echo ""
echo "=== ShipFlow installed ==="
