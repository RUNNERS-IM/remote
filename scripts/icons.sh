#!/bin/bash
# Makes every app icon from the shared RUNNERS white and black plates in build/icon-source (1024 canvas, 824 plate,
# glyph 55%), the same way as Prompt's resources/icon-source/generate.sh:
#   build/Assets.car  macOS 26: white plate, and the black plate when the Mac uses dark icons
#   build/icon.icns   older macOS and Linux, with the usual 100px Mac margin
#   build/icon.png    the white plate as is
#   build/icon.ico    Windows, margin trimmed (scripts/windows-icon.mjs)
# Run from the repository root after replacing a plate: bash scripts/icons.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/build/icon-source"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Why: macOS 26 draws its own rounded shape on the full canvas, so icon.icon holds the 824 plates scaled to 1024.
for COLOR in white black; do
  sips -c 824 824 "$SOURCE/remote-$COLOR.png" --out "$TMP/$COLOR.png" >/dev/null
  sips -z 1024 1024 "$TMP/$COLOR.png" --out "$SOURCE/icon.icon/Assets/$COLOR.png" >/dev/null
done
xcrun actool --compile "$TMP" --platform macosx --minimum-deployment-target 10.12 --app-icon icon \
  --output-partial-info-plist "$TMP/partial.plist" "$SOURCE/icon.icon" >/dev/null
cp "$TMP/Assets.car" "$ROOT/build/Assets.car"

mkdir "$TMP/icon.iconset"
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$SOURCE/remote-white.png" --out "$TMP/icon.iconset/icon_${SIZE}x${SIZE}.png" >/dev/null
  sips -z $((SIZE * 2)) $((SIZE * 2)) "$SOURCE/remote-white.png" --out "$TMP/icon.iconset/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/icon.iconset" -o "$ROOT/build/icon.icns"

cp "$SOURCE/remote-white.png" "$ROOT/build/icon.png"
node "$ROOT/scripts/windows-icon.mjs"
echo "build/Assets.car, icon.icns, icon.png, icon.ico"
