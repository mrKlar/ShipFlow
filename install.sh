#!/usr/bin/env bash
set -euo pipefail

SHIPFLOW_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== ShipFlow Installer ==="
echo ""

# --- 1. Install globally via npm ---
echo "[1/2] Installing shipflow globally..."
npm install -g "$SHIPFLOW_DIR"
echo "  OK — $(which shipflow)"

# --- 2. Register Claude Code plugin (if claude is available) ---
echo "[2/2] Installing Claude Code plugin..."

if command -v claude &>/dev/null; then
  claude plugin marketplace remove shipflow 2>/dev/null || true
  claude plugin marketplace add "$SHIPFLOW_DIR"
  echo "  Registered ShipFlow marketplace"

  claude plugin uninstall shipflow@shipflow 2>/dev/null || true
  claude plugin install shipflow@shipflow 2>/dev/null || true
  echo "  OK"
else
  echo "  Claude Code not found — skipping plugin install"
fi

echo ""
echo "=== ShipFlow installed ==="
echo ""
echo "Usage:"
echo "  In any project directory:"
echo "    shipflow init                  — scaffold project (Claude Code)"
echo "    shipflow init --codex          — scaffold for Codex CLI"
echo "    shipflow init --gemini         — scaffold for Gemini CLI"
echo ""
echo "  Or with Claude Code plugin (restart Claude first):"
echo "    /shipflow-verifications        — draft verifications"
echo "    /shipflow-impl                 — build the app"
