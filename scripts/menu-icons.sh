#!/bin/bash
# Makes the tray menu icons in src-tauri/icons/menu/ from the official Lucide SVGs.
# Each icon comes in black (light menus) and white (dark menus) at 36 px, which is 2x of the 18 pt slot muda draws menu icons in.
# The status dots are filled circles in the system green, yellow, red and grey.
# The menu bar picture (tray.png) is Lucide screen-share in black; macOS draws it as a template image, so it follows the menu bar colour.
# Needs macOS 14 or later (AppKit reads SVG) and network access to unpkg.com.
set -euo pipefail

LUCIDE_VERSION=1.63.0
PIXELS=36
ICONS=(app-window info refresh-cw settings circle-help square-x)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/icons/menu"
DRAW="$ROOT/scripts/menu-icons.swift"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

for name in "${ICONS[@]}"; do
  curl -sfL "https://unpkg.com/lucide-static@$LUCIDE_VERSION/icons/$name.svg" -o "$WORK/$name.svg"
  for tone in black:#000000 white:#ffffff; do
    label="${tone%%:*}"
    color="${tone#*:}"
    # Why: the shared spec uses stroke width 1.5 instead of Lucide's default 2.
    sed -e "s/currentColor/$color/g" -e 's/stroke-width="2"/stroke-width="1.5"/' "$WORK/$name.svg" > "$WORK/$name-$label.svg"
    swift "$DRAW" "$WORK/$name-$label.svg" "$OUT/$name-$label.png" "$PIXELS"
  done
done

# Why: a 9 pt dot centred in the 18 pt slot lines up with the icons below it.
for dot in green:#34c759 yellow:#ffcc00 red:#ff3b30 grey:#8e8e93; do
  label="${dot%%:*}"
  color="${dot#*:}"
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="%s"/></svg>' "$color" > "$WORK/dot-$label.svg"
  swift "$DRAW" "$WORK/dot-$label.svg" "$OUT/dot-$label.png" "$PIXELS"
done

curl -sfL "https://unpkg.com/lucide-static@$LUCIDE_VERSION/icons/screen-share.svg" -o "$WORK/screen-share.svg"
sed -e 's/currentColor/#000000/g' -e 's/stroke-width="2"/stroke-width="1.5"/' "$WORK/screen-share.svg" > "$WORK/tray.svg"
swift "$DRAW" "$WORK/tray.svg" "$ROOT/src-tauri/icons/tray.png" "$PIXELS"

echo "wrote $(ls "$OUT" | wc -l | tr -d ' ') files to $OUT"
