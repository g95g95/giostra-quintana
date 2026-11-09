#!/usr/bin/env bash
# Uso: bash tools/shot.sh "<pagina>?<query>" <output.png> [larghezza] [altezza]
# Esempio: bash tools/shot.sh "dev/preview.html?mods=world&cam=60,45,110" shots/world.png
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -W 2>/dev/null || pwd)"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
OUT="$ROOT/$2"
W="${3:-1280}"
H="${4:-720}"
PROFILE="$(mktemp -d)"
"$EDGE" --headless=new --disable-gpu-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader \
  --no-first-run --user-data-dir="$PROFILE" --hide-scrollbars --window-size="$W,$H" \
  --virtual-time-budget=8000 --screenshot="$OUT" "file:///$ROOT/$1" >/dev/null 2>&1 || true
rm -rf "$PROFILE" 2>/dev/null || true
[ -f "$OUT" ] && echo "ok $2" || { echo "screenshot fallito" >&2; exit 1; }
