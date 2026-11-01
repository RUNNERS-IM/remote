#!/bin/bash
# Builds remote-link (link/, Go) into link/bin.noindex/remote-link-<os>-<cpu>[.exe], the name electron-builder packs.
#   scripts/build-link.sh                 this computer's OS and CPU
#   scripts/build-link.sh darwin x64      another one (os: darwin, win32, linux; cpu: arm64, x64), as Node names them
# Go cross-compiles without a C compiler (CGO is off), so CI builds every OS and CPU from one runner.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OS="${1:-$(node -p process.platform)}"
CPU="${2:-$(node -p process.arch)}"

case "$OS" in
  darwin) GOOS=darwin ;;
  win32) GOOS=windows ;;
  linux) GOOS=linux ;;
  *) echo "unknown os $OS" >&2; exit 2 ;;
esac
case "$CPU" in
  arm64) GOARCH=arm64 ;;
  x64) GOARCH=amd64 ;;
  *) echo "unknown cpu $CPU" >&2; exit 2 ;;
esac
EXT=""
[ "$OS" = win32 ] && EXT=".exe"

OUT="$ROOT/link/bin.noindex/remote-link-$OS-$CPU$EXT"
mkdir -p "$ROOT/link/bin.noindex"
cd "$ROOT/link"
# Why -s -w: the symbol tables are about a third of the file and nobody debugs the shipped program.
CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build -trimpath -ldflags="-s -w" -o "$OUT" .
echo "$OUT"
