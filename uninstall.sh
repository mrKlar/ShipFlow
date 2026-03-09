#!/usr/bin/env bash
# ShipFlow Uninstaller
#
# Remote:  curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/uninstall.sh | bash
# Local:   ./uninstall.sh
#
set -euo pipefail

INSTALL_DIR="${SHIPFLOW_HOME:-$HOME/.shipflow}"

# Colors (disabled when piped)
if [ -t 1 ]; then
  B="\033[1m" G="\033[32m" Y="\033[33m" D="\033[2m" R="\033[0m"
else
  B="" G="" Y="" D="" R=""
fi

info()  { printf "  ${G}✓${R} %s\n" "$1"; }
skip()  { printf "  ${D}– %s${R}\n" "$1"; }
step()  { printf "\n${B}[%s]${R} %s\n" "$1" "$2"; }

printf "\n${B}ShipFlow Uninstaller${R}\n"

# --- 1. Claude Code ---
step "1/5" "Claude Code"

if command -v claude &>/dev/null; then
  claude plugin uninstall shipflow@shipflow 2>/dev/null || true
  claude plugin marketplace remove shipflow 2>/dev/null || true
  info "Plugin removed"
else
  skip "Claude Code not found"
fi

# --- 2. Codex CLI ---
step "2/5" "Codex CLI"

if [ -d "$HOME/.agents/skills/shipflow-verifications" ] || [ -d "$HOME/.agents/skills/shipflow-impl" ] || [ -d "$HOME/.agents/skills/shipflow-implement" ]; then
  rm -rf "$HOME/.agents/skills/shipflow-verifications" "$HOME/.agents/skills/shipflow-impl" "$HOME/.agents/skills/shipflow-implement"
  info "Skills removed"
else
  skip "No Codex skills found"
fi

if [ -f "$HOME/.codex/rules/shipflow.rules" ]; then
  rm -f "$HOME/.codex/rules/shipflow.rules"
  info "Exec policy removed"
else
  skip "No exec policy found"
fi

CODEX_INSTRUCTIONS="$HOME/.codex/instructions.md"
SHIPFLOW_MARKER="<!-- shipflow -->"
if [ -f "$CODEX_INSTRUCTIONS" ] && grep -q "$SHIPFLOW_MARKER" "$CODEX_INSTRUCTIONS" 2>/dev/null; then
  TMPFILE=$(mktemp)
  sed "/$SHIPFLOW_MARKER/,\$d" "$CODEX_INSTRUCTIONS" > "$TMPFILE"
  # Remove trailing blank lines
  sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$TMPFILE" 2>/dev/null || true
  if [ -s "$TMPFILE" ]; then
    mv "$TMPFILE" "$CODEX_INSTRUCTIONS"
    info "Instructions cleaned: ~/.codex/instructions.md"
  else
    rm -f "$TMPFILE" "$CODEX_INSTRUCTIONS"
    info "Instructions removed: ~/.codex/instructions.md"
  fi
else
  skip "No Codex instructions found"
fi

# --- 3. Gemini CLI ---
step "3/5" "Gemini CLI"

if command -v gemini &>/dev/null; then
  gemini extensions uninstall shipflow 2>/dev/null || true
  info "Extension removed"
else
  skip "Gemini CLI not found"
fi

GEMINI_SETTINGS="$HOME/.gemini/settings.json"
if [ -f "$GEMINI_SETTINGS" ] && grep -q "shipflow" "$GEMINI_SETTINGS" 2>/dev/null; then
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$GEMINI_SETTINGS', 'utf-8'));
    if (settings.hooks && settings.hooks.BeforeTool) {
      settings.hooks.BeforeTool = settings.hooks.BeforeTool.filter(
        entry => !JSON.stringify(entry).includes('shipflow')
      );
      if (settings.hooks.BeforeTool.length === 0) delete settings.hooks.BeforeTool;
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    }
    fs.writeFileSync('$GEMINI_SETTINGS', JSON.stringify(settings, null, 2) + '\n');
  "
  info "Hooks removed from ~/.gemini/settings.json"
else
  skip "No Gemini hooks found"
fi

# --- 4. Kiro CLI ---
step "4/5" "Kiro CLI"

if [ -d "$HOME/.kiro/skills/shipflow-verifications" ] || [ -d "$HOME/.kiro/skills/shipflow-impl" ] || [ -d "$HOME/.kiro/skills/shipflow-implement" ]; then
  rm -rf "$HOME/.kiro/skills/shipflow-verifications" "$HOME/.kiro/skills/shipflow-impl" "$HOME/.kiro/skills/shipflow-implement"
  info "Skills removed"
else
  skip "No Kiro skills found"
fi

if [ -f "$HOME/.kiro/steering/shipflow.md" ]; then
  rm -f "$HOME/.kiro/steering/shipflow.md"
  info "Steering removed"
else
  skip "No Kiro steering found"
fi

# --- 5. Global CLI & source ---
step "5/5" "ShipFlow CLI"

# Remove symlinks
LOCAL_BIN="$HOME/.local/bin"
for cmd in shipflow shipflow-guard shipflow-stop shipflow-gemini-guard shipflow-kiro-guard; do
  if [ -L "$LOCAL_BIN/$cmd" ]; then
    rm -f "$LOCAL_BIN/$cmd"
  fi
done
info "Symlinks removed from ~/.local/bin"

# Uninstall global npm package
npm uninstall -g shipflow-framework --silent 2>/dev/null || true
info "Global npm package removed"

# Remove cloned source (only if it's the default install location)
if [ -d "$INSTALL_DIR/.git" ] && [ "$INSTALL_DIR" = "$HOME/.shipflow" ]; then
  rm -rf "$INSTALL_DIR"
  info "Removed $INSTALL_DIR"
else
  skip "Skipping source removal (custom or local install)"
fi

printf "\n${G}${B}ShipFlow uninstalled.${R}\n\n"
