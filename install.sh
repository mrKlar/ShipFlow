#!/usr/bin/env bash
# ShipFlow Installer
#
# Remote:  curl -fsSL https://raw.githubusercontent.com/mrKlar/ShipFlow/main/install.sh | bash
# Local:   ./install.sh
#
set -euo pipefail

REPO="https://github.com/mrKlar/ShipFlow.git"
INSTALL_DIR="${SHIPFLOW_HOME:-$HOME/.shipflow}"

# Colors (disabled when piped)
if [ -t 1 ]; then
  B="\033[1m" G="\033[32m" Y="\033[33m" C="\033[36m" D="\033[2m" R="\033[0m"
else
  B="" G="" Y="" C="" D="" R=""
fi

info()  { printf "  ${G}✓${R} %s\n" "$1"; }
skip()  { printf "  ${D}– %s${R}\n" "$1"; }
warn()  { printf "  ${Y}! %s${R}\n" "$1"; }
step()  { printf "\n${B}[%s]${R} %s\n" "$1" "$2"; }

printf "\n${B}ShipFlow${R} — verification-first development for AI coding agents\n"

# --- 1. Prerequisites ---
step "1/4" "Checking prerequisites"

if ! command -v node &>/dev/null; then
  printf "\n${Y}Node.js is required but not installed.${R}\n"
  echo "  Install it: https://nodejs.org (v18+)"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  printf "\n${Y}Node.js 18+ required. Found: $(node -v)${R}\n"
  exit 1
fi
info "Node.js $(node -v)"

if ! command -v npm &>/dev/null; then
  printf "\n${Y}npm is required but not found.${R}\n"
  exit 1
fi
info "npm $(npm -v)"

if ! command -v git &>/dev/null; then
  printf "\n${Y}git is required but not found.${R}\n"
  exit 1
fi
info "git $(git --version | awk '{print $3}')"

# --- 2. Get ShipFlow source ---
step "2/4" "Installing ShipFlow"

# Detect if running from inside the repo
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
fi

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/bin/shipflow.js" ]; then
  INSTALL_DIR="$SCRIPT_DIR"
  info "Using local repo: $INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --quiet 2>/dev/null || true
  info "Updated $INSTALL_DIR"
else
  echo "  Cloning to $INSTALL_DIR..."
  git clone --quiet --depth 1 "$REPO" "$INSTALL_DIR"
  info "Cloned to $INSTALL_DIR"
fi

npm install --prefix "$INSTALL_DIR" --omit=dev --silent 2>/dev/null
info "Dependencies installed"

npm install -g "$INSTALL_DIR" --silent 2>/dev/null
info "Global commands: shipflow, shipflow-guard, shipflow-stop"

# Ensure commands are in a standard PATH location (for AI agents that skip shell init)
NPM_BIN="$(npm prefix -g)/bin"
LOCAL_BIN="$HOME/.local/bin"
if [ -d "$NPM_BIN" ] && [ -f "$NPM_BIN/shipflow" ]; then
  mkdir -p "$LOCAL_BIN"
  for cmd in shipflow shipflow-guard shipflow-stop shipflow-gemini-guard; do
    if [ -f "$NPM_BIN/$cmd" ] && [ ! -f "$LOCAL_BIN/$cmd" ]; then
      ln -sf "$NPM_BIN/$cmd" "$LOCAL_BIN/$cmd"
    fi
  done
  # Add ~/.local/bin to PATH if not already there
  if [[ ":$PATH:" != *":$LOCAL_BIN:"* ]]; then
    for rcfile in "$HOME/.bashrc" "$HOME/.zshrc"; do
      if [ -f "$rcfile" ] && ! grep -q 'local/bin' "$rcfile" 2>/dev/null; then
        printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rcfile"
      fi
    done
  fi
  info "Symlinks in ~/.local/bin (accessible to all AI agents)"
fi

# --- 3. Detect and configure AI platforms ---
step "3/4" "Detecting and configuring AI coding agents"

FOUND=()

# --- Claude Code ---
if command -v claude &>/dev/null; then
  info "Claude Code found"
  FOUND+=("claude")
  claude plugin marketplace remove shipflow 2>/dev/null || true
  claude plugin marketplace add "$INSTALL_DIR" 2>/dev/null || true
  claude plugin uninstall shipflow@shipflow 2>/dev/null || true
  claude plugin install shipflow@shipflow 2>/dev/null || true
  info "Plugin installed: /shipflow-verifications, /shipflow-impl"
else
  skip "Claude Code not found"
fi

# --- Codex CLI ---
if command -v codex &>/dev/null; then
  info "Codex CLI found"
  FOUND+=("codex")

  # Global exec policy rules
  mkdir -p "$HOME/.codex/rules"
  cp "$INSTALL_DIR/templates/codex-rules.rules" "$HOME/.codex/rules/shipflow.rules"
  info "Exec policy: ~/.codex/rules/shipflow.rules"

  # Global instructions (append to existing or create)
  CODEX_INSTRUCTIONS="$HOME/.codex/instructions.md"
  SHIPFLOW_MARKER="<!-- shipflow -->"
  if [ -f "$CODEX_INSTRUCTIONS" ]; then
    if ! grep -q "$SHIPFLOW_MARKER" "$CODEX_INSTRUCTIONS" 2>/dev/null; then
      printf "\n%s\n" "$SHIPFLOW_MARKER" >> "$CODEX_INSTRUCTIONS"
      cat "$INSTALL_DIR/templates/AGENTS.md" >> "$CODEX_INSTRUCTIONS"
      info "Instructions appended to ~/.codex/instructions.md"
    else
      # Replace existing ShipFlow block
      TMPFILE=$(mktemp)
      sed "/$SHIPFLOW_MARKER/,\$d" "$CODEX_INSTRUCTIONS" > "$TMPFILE"
      printf "%s\n" "$SHIPFLOW_MARKER" >> "$TMPFILE"
      cat "$INSTALL_DIR/templates/AGENTS.md" >> "$TMPFILE"
      mv "$TMPFILE" "$CODEX_INSTRUCTIONS"
      info "Instructions updated in ~/.codex/instructions.md"
    fi
  else
    printf "%s\n" "$SHIPFLOW_MARKER" > "$CODEX_INSTRUCTIONS"
    cat "$INSTALL_DIR/templates/AGENTS.md" >> "$CODEX_INSTRUCTIONS"
    info "Instructions created: ~/.codex/instructions.md"
  fi
else
  skip "Codex CLI not found"
fi

# --- Gemini CLI ---
if command -v gemini &>/dev/null; then
  info "Gemini CLI found"
  FOUND+=("gemini")

  # Global instructions
  GEMINI_MD="$HOME/.gemini/GEMINI.md"
  SHIPFLOW_MARKER="<!-- shipflow -->"
  if [ -f "$GEMINI_MD" ]; then
    if ! grep -q "$SHIPFLOW_MARKER" "$GEMINI_MD" 2>/dev/null; then
      printf "\n%s\n" "$SHIPFLOW_MARKER" >> "$GEMINI_MD"
      cat "$INSTALL_DIR/templates/GEMINI.md" >> "$GEMINI_MD"
      info "Instructions appended to ~/.gemini/GEMINI.md"
    else
      TMPFILE=$(mktemp)
      sed "/$SHIPFLOW_MARKER/,\$d" "$GEMINI_MD" > "$TMPFILE"
      printf "%s\n" "$SHIPFLOW_MARKER" >> "$TMPFILE"
      cat "$INSTALL_DIR/templates/GEMINI.md" >> "$TMPFILE"
      mv "$TMPFILE" "$GEMINI_MD"
      info "Instructions updated in ~/.gemini/GEMINI.md"
    fi
  else
    mkdir -p "$HOME/.gemini"
    printf "%s\n" "$SHIPFLOW_MARKER" > "$GEMINI_MD"
    cat "$INSTALL_DIR/templates/GEMINI.md" >> "$GEMINI_MD"
    info "Instructions created: ~/.gemini/GEMINI.md"
  fi

  # Merge hooks into settings.json
  GEMINI_SETTINGS="$HOME/.gemini/settings.json"
  GUARD_CMD="shipflow-gemini-guard"
  if [ -f "$GEMINI_SETTINGS" ]; then
    if ! grep -q "shipflow" "$GEMINI_SETTINGS" 2>/dev/null; then
      # Merge ShipFlow hooks into existing settings using node
      node -e "
        const fs = require('fs');
        const settings = JSON.parse(fs.readFileSync('$GEMINI_SETTINGS', 'utf-8'));
        if (!settings.hooks) settings.hooks = {};
        if (!settings.hooks.BeforeTool) settings.hooks.BeforeTool = [];
        settings.hooks.BeforeTool.push({
          matcher: 'write_file|replace',
          hooks: [{
            name: 'shipflow-guard',
            type: 'command',
            command: '$GUARD_CMD',
            timeout: 5000
          }]
        });
        fs.writeFileSync('$GEMINI_SETTINGS', JSON.stringify(settings, null, 2) + '\n');
      "
      info "Hooks merged into ~/.gemini/settings.json"
    else
      info "Hooks already in ~/.gemini/settings.json"
    fi
  else
    mkdir -p "$HOME/.gemini"
    cat > "$GEMINI_SETTINGS" << EOJSON
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "name": "shipflow-guard",
            "type": "command",
            "command": "$GUARD_CMD",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
EOJSON
    info "Settings created: ~/.gemini/settings.json"
  fi
else
  skip "Gemini CLI not found"
fi

if [ ${#FOUND[@]} -eq 0 ]; then
  warn "No AI coding agents detected"
  warn "Install one: Claude Code, Codex CLI, or Gemini CLI"
fi

# --- 4. Summary ---
step "4/4" "Done"

printf "\n${G}${B}ShipFlow installed successfully.${R}\n\n"

if [ ${#FOUND[@]} -gt 0 ]; then
  printf "${B}Configured platforms:${R}\n"
  for p in "${FOUND[@]}"; do
    case "$p" in
      claude) printf "  ${C}Claude Code${R}  — plugin + hooks (restart Claude Code)\n" ;;
      codex)  printf "  ${C}Codex CLI${R}    — global rules + instructions\n" ;;
      gemini) printf "  ${C}Gemini CLI${R}   — global hooks + instructions\n" ;;
    esac
  done
  echo ""
fi

printf "${B}Quick start:${R}\n\n"
echo "  cd your-project"
echo "  shipflow init          # scaffold vp/, config, .gitignore"
echo ""

if [[ " ${FOUND[*]:-} " == *" claude "* ]]; then
  printf "  ${D}# Claude Code:${R}\n"
  echo "  /shipflow-verifications a todo app"
  echo "  /shipflow-impl"
  echo ""
fi

if [[ " ${FOUND[*]:-} " == *" codex "* ]]; then
  printf "  ${D}# Codex CLI:${R}\n"
  echo "  codex \"read vp/ and implement the app until shipflow verify passes\""
  echo ""
fi

if [[ " ${FOUND[*]:-} " == *" gemini "* ]]; then
  printf "  ${D}# Gemini CLI:${R}\n"
  echo "  gemini \"read vp/ and implement the app until shipflow verify passes\""
  echo ""
fi
