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

# --- 3. Detect and configure AI platforms ---
step "3/4" "Detecting AI coding agents"

FOUND=()

# Claude Code
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

# Codex CLI
if command -v codex &>/dev/null; then
  info "Codex CLI found"
  FOUND+=("codex")
else
  skip "Codex CLI not found"
fi

# Gemini CLI
if command -v gemini &>/dev/null; then
  info "Gemini CLI found"
  FOUND+=("gemini")
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
  printf "${B}Detected platforms:${R}\n"
  for p in "${FOUND[@]}"; do
    case "$p" in
      claude) printf "  ${C}Claude Code${R}  — plugin ready (restart Claude Code)\n" ;;
      codex)  printf "  ${C}Codex CLI${R}    — run: shipflow init --codex\n" ;;
      gemini) printf "  ${C}Gemini CLI${R}   — run: shipflow init --gemini\n" ;;
    esac
  done
  echo ""
fi

printf "${B}Quick start:${R}\n\n"
echo "  cd your-project"
echo ""

if [[ " ${FOUND[*]:-} " == *" claude "* ]]; then
  printf "  ${D}# With Claude Code (restart it first):${R}\n"
  echo "  /shipflow-verifications a todo app"
  echo "  /shipflow-impl"
  echo ""
fi

printf "  ${D}# With the CLI:${R}\n"
echo "  shipflow init          # scaffold project"
echo "  shipflow gen           # compile verifications → tests"
echo "  shipflow verify        # run tests"
echo ""
