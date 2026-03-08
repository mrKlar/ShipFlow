#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -e "console.log(require('$ROOT/package.json').version)")
OUT="$ROOT/dist/shipflow-${VERSION}.tar.gz"

mkdir -p "$ROOT/dist"

tar czf "$OUT" \
  --transform="s,^,shipflow/," \
  -C "$ROOT" \
  .claude-plugin/ \
  bin/ \
  lib/ \
  hooks/ \
  plugin/ \
  templates/ \
  package.json \
  install.sh \
  README.md

echo "Built $OUT"
echo "Install: tar xzf shipflow-${VERSION}.tar.gz && cd shipflow && ./install.sh"
