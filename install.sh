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

printf "\n${B}ShipFlow${R} — verification-first shipping for AI coding agents\n"

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
info "Global commands: shipflow, shipflow-guard, shipflow-bash-guard, shipflow-stop"

# Ensure commands are in a standard PATH location (for AI agents that skip shell init)
NPM_BIN="$(npm prefix -g)/bin"
LOCAL_BIN="$HOME/.local/bin"
if [ -d "$NPM_BIN" ] && [ -f "$NPM_BIN/shipflow" ]; then
  mkdir -p "$LOCAL_BIN"
  for cmd in shipflow shipflow-guard shipflow-bash-guard shipflow-stop shipflow-gemini-guard shipflow-kiro-guard; do
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
  CLAUDE_AGENTS="$HOME/.claude/agents"
  mkdir -p "$CLAUDE_AGENTS"
  find "$CLAUDE_AGENTS" -maxdepth 1 -type f -name 'shipflow-*.md' -delete 2>/dev/null || true
  for agent_file in "$INSTALL_DIR"/claude-agents/shipflow-*.md; do
    [ -f "$agent_file" ] || continue
    cp "$agent_file" "$CLAUDE_AGENTS/"
  done
  info "Native subagents installed: ~/.claude/agents/shipflow-*.md"
  rm -rf "$HOME/.claude/plugins/cache/shipflow" 2>/dev/null || true
  claude plugin marketplace remove shipflow 2>/dev/null || true
  claude plugin marketplace add "$INSTALL_DIR" 2>/dev/null || true
  claude plugin uninstall shipflow@shipflow 2>/dev/null || true
  claude plugin install shipflow@shipflow 2>/dev/null || true
  info "Plugin installed: /shipflow:draft, /shipflow:implement, plus native debug commands"
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

  # Install native skills (global: ~/.codex/skills/)
  CODEX_SKILLS="$HOME/.codex/skills"
  mkdir -p "$CODEX_SKILLS"
  find "$CODEX_SKILLS" -maxdepth 1 -type d -name 'shipflow-*' -exec rm -rf {} + 2>/dev/null || true
  for skill_dir in "$INSTALL_DIR"/codex-skills/shipflow-*; do
    [ -d "$skill_dir" ] || continue
    cp -r "$skill_dir" "$CODEX_SKILLS/"
  done
  info "Native skills installed: ~/.codex/skills/shipflow-*"
else
  skip "Codex CLI not found"
fi

# --- Gemini CLI ---
if command -v gemini &>/dev/null; then
  info "Gemini CLI found"
  FOUND+=("gemini")

  # Install extension
  gemini extensions install "$INSTALL_DIR/gemini-extension" --consent 2>/dev/null || true
  info "Extension installed: /shipflow:draft, /shipflow:implement, /shipflow:strategy-lead, and native specialist commands"

  # Merge hooks into settings.json
  GEMINI_SETTINGS="$HOME/.gemini/settings.json"
  GUARD_CMD="shipflow-gemini-guard"
  if [ -f "$GEMINI_SETTINGS" ]; then
    node -e "
      const fs = require('fs');
      const settings = JSON.parse(fs.readFileSync('$GEMINI_SETTINGS', 'utf-8'));
      if (!settings.hooks) settings.hooks = {};
      if (!Array.isArray(settings.hooks.BeforeTool)) settings.hooks.BeforeTool = [];
      const required = [
        { matcher: 'write_file|replace', name: 'shipflow-guard', command: '$GUARD_CMD' },
        { matcher: 'run_shell_command|shell', name: 'shipflow-shell-guard', command: '$GUARD_CMD' }
      ];
      for (const spec of required) {
        let existing = settings.hooks.BeforeTool.find(h => h && h.matcher === spec.matcher);
        if (!existing) {
          existing = { matcher: spec.matcher, hooks: [] };
          settings.hooks.BeforeTool.push(existing);
        }
        if (!Array.isArray(existing.hooks)) existing.hooks = [];
        if (!existing.hooks.some(h => h && h.command === spec.command)) {
          existing.hooks.push({
            name: spec.name,
            type: 'command',
            command: spec.command,
            timeout: 5000
          });
        }
      }
      fs.writeFileSync('$GEMINI_SETTINGS', JSON.stringify(settings, null, 2) + '\n');
    "
    info "Hooks merged into ~/.gemini/settings.json"
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
      },
      {
        "matcher": "run_shell_command|shell",
        "hooks": [
          {
            "name": "shipflow-shell-guard",
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

# --- Kiro CLI ---
if command -v kiro-cli &>/dev/null || command -v kiro &>/dev/null; then
  info "Kiro CLI found"
  FOUND+=("kiro")

  # Install native skills (global: ~/.kiro/skills/)
  KIRO_SKILLS="$HOME/.kiro/skills"
  mkdir -p "$KIRO_SKILLS"
  find "$KIRO_SKILLS" -maxdepth 1 -type d -name 'shipflow-*' -exec rm -rf {} + 2>/dev/null || true
  for skill_dir in "$INSTALL_DIR"/kiro-skills/shipflow-*; do
    [ -d "$skill_dir" ] || continue
    cp -r "$skill_dir" "$KIRO_SKILLS/"
  done
  info "Native skills installed: ~/.kiro/skills/shipflow-*"

  KIRO_AGENTS="$HOME/.kiro/agents"
  mkdir -p "$KIRO_AGENTS"
  find "$KIRO_AGENTS" -maxdepth 1 -type f -name 'shipflow-*.md' -delete 2>/dev/null || true
  for agent_file in "$INSTALL_DIR"/kiro-agents/shipflow-*.md; do
    [ -f "$agent_file" ] || continue
    cp "$agent_file" "$KIRO_AGENTS/"
  done
  info "Native custom agents installed: ~/.kiro/agents/shipflow-*.md"

  # Global steering context
  KIRO_STEERING="$HOME/.kiro/steering"
  mkdir -p "$KIRO_STEERING"
  cp "$INSTALL_DIR/templates/KIRO.md" "$KIRO_STEERING/shipflow.md"
  info "Steering: ~/.kiro/steering/shipflow.md"

  KIRO_SETTINGS="$HOME/.kiro/settings.json"
  KIRO_GUARD_CMD="shipflow-kiro-guard"
  if [ -f "$KIRO_SETTINGS" ]; then
    node -e "
      const fs = require('fs');
      const settings = JSON.parse(fs.readFileSync('$KIRO_SETTINGS', 'utf-8'));
      if (!settings.hooks) settings.hooks = {};
      if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];
      if (!Array.isArray(settings.availableAgents)) settings.availableAgents = [];
      if (!Array.isArray(settings.trustedAgents)) settings.trustedAgents = [];
      const required = [
        { matcher: 'write_file|replace', command: '$KIRO_GUARD_CMD' },
        { matcher: 'execute_bash|shell', command: '$KIRO_GUARD_CMD' }
      ];
      const requiredAgents = [
        'shipflow-strategy-lead',
        'shipflow-architecture-specialist',
        'shipflow-ui-specialist',
        'shipflow-api-specialist',
        'shipflow-database-specialist',
        'shipflow-security-specialist',
        'shipflow-technical-specialist'
      ];
      for (const spec of required) {
        if (!settings.hooks.PreToolUse.some(h => h && h.matcher === spec.matcher && h.command === spec.command)) {
          settings.hooks.PreToolUse.push(spec);
        }
      }
      for (const agent of requiredAgents) {
        if (!settings.availableAgents.includes(agent)) settings.availableAgents.push(agent);
        if (!settings.trustedAgents.includes(agent)) settings.trustedAgents.push(agent);
      }
      fs.writeFileSync('$KIRO_SETTINGS', JSON.stringify(settings, null, 2) + '\n');
    "
    info "Hooks merged into ~/.kiro/settings.json"
  else
    cat > "$KIRO_SETTINGS" << EOJSON
{
  "availableAgents": [
    "shipflow-strategy-lead",
    "shipflow-architecture-specialist",
    "shipflow-ui-specialist",
    "shipflow-api-specialist",
    "shipflow-database-specialist",
    "shipflow-security-specialist",
    "shipflow-technical-specialist"
  ],
  "trustedAgents": [
    "shipflow-strategy-lead",
    "shipflow-architecture-specialist",
    "shipflow-ui-specialist",
    "shipflow-api-specialist",
    "shipflow-database-specialist",
    "shipflow-security-specialist",
    "shipflow-technical-specialist"
  ],
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "write_file|replace",
        "command": "$KIRO_GUARD_CMD"
      },
      {
        "matcher": "execute_bash|shell",
        "command": "$KIRO_GUARD_CMD"
      }
    ]
  }
}
EOJSON
    info "Settings created: ~/.kiro/settings.json"
  fi
else
  skip "Kiro CLI not found"
fi

if [ ${#FOUND[@]} -eq 0 ]; then
  warn "No AI coding agents detected"
  warn "Install one: Claude Code, Codex CLI, Gemini CLI, or Kiro CLI"
fi

# --- 4. Summary ---
step "4/4" "Done"

printf "\n${G}${B}ShipFlow installed successfully.${R}\n\n"

if [ ${#FOUND[@]} -gt 0 ]; then
  printf "${B}Configured platforms:${R}\n"
  for p in "${FOUND[@]}"; do
    case "$p" in
      claude) printf "  ${C}Claude Code${R}  — plugin + native subagents (restart Claude Code)\n" ;;
      codex)  printf "  ${C}Codex CLI${R}    — native skills + rules + instructions\n" ;;
      gemini) printf "  ${C}Gemini CLI${R}   — extension + native specialist commands + hooks\n" ;;
      kiro)   printf "  ${C}Kiro CLI${R}     — native skills + custom agents + steering\n" ;;
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
  echo "  /shipflow:draft a todo app"
  echo "  /shipflow:implement"
  echo ""
fi

if [[ " ${FOUND[*]:-} " == *" codex "* ]]; then
  printf "  ${D}# Codex CLI:${R}\n"
  echo "  \$shipflow-draft a todo app"
  echo "  \$shipflow-implement"
  echo ""
fi

if [[ " ${FOUND[*]:-} " == *" gemini "* ]]; then
  printf "  ${D}# Gemini CLI:${R}\n"
  echo "  /shipflow:draft a todo app"
  echo "  /shipflow:implement"
  echo ""
fi

if [[ " ${FOUND[*]:-} " == *" kiro "* ]]; then
  printf "  ${D}# Kiro CLI (custom agents + skills):${R}\n"
  echo "  \"let's draft ShipFlow verifications for a todo app\""
  echo "  \"run shipflow implement once the draft is ready\""
  echo ""
fi
