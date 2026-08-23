#!/usr/bin/env bash
# Generate macOS .icns, Windows .ico, and PNG app icons from the high-resolution source.
#
# The source is a Dock-ready squircle featuring the OptiMate camera mascot.
#
# Requires: sips, iconutil, and ImageMagick 7.
#
# Output: build/icon.icns, build/icon.ico, build/icon.png

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT/build"
SOURCE="$BUILD_DIR/app-icon-camera-1024.png"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ ! -f "$SOURCE" ]]; then
  echo "Missing icon source: $SOURCE" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"

# ----- 1. Generate macOS .icns -----
# Required sizes in an .iconset directory:
#   icon_16x16.png, icon_16x16@2x.png, icon_32x32.png, icon_32x32@2x.png,
#   icon_128x128.png, icon_128x128@2x.png, icon_256x256.png, icon_256x256@2x.png,
#   icon_512x512.png, icon_512x512@2x.png
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"

sips -z 16   16   "$SOURCE" --out "$ICONSET/icon_16x16.png"       >/dev/null
sips -z 32   32   "$SOURCE" --out "$ICONSET/icon_16x16@2x.png"    >/dev/null
sips -z 32   32   "$SOURCE" --out "$ICONSET/icon_32x32.png"       >/dev/null
sips -z 64   64   "$SOURCE" --out "$ICONSET/icon_32x32@2x.png"    >/dev/null
sips -z 128  128  "$SOURCE" --out "$ICONSET/icon_128x128.png"     >/dev/null
sips -z 256  256  "$SOURCE" --out "$ICONSET/icon_128x128@2x.png"  >/dev/null
sips -z 256  256  "$SOURCE" --out "$ICONSET/icon_256x256.png"     >/dev/null
sips -z 512  512  "$SOURCE" --out "$ICONSET/icon_256x256@2x.png"  >/dev/null
sips -z 512  512  "$SOURCE" --out "$ICONSET/icon_512x512.png"     >/dev/null
cp "$SOURCE" "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$BUILD_DIR/icon.icns"

# ----- 2. Generate Windows .ico (multi-size) -----
# 16, 24, 32, 48, 64, 128, 256 in one .ico file.
magick "$SOURCE" \
  -define icon:auto-resize=256,128,64,48,32,24,16 \
  "$BUILD_DIR/icon.ico"

# ----- 3. 512 PNG fallback (used by Linux builds + electron-builder default) -----
sips -z 512 512 "$SOURCE" --out "$BUILD_DIR/icon.png" >/dev/null

echo ""
echo "✓ Generated:"
ls -lh "$BUILD_DIR/"
