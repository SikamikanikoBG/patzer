#!/usr/bin/env sh
# setup.sh — Downloads the Stockfish binary for local Linux / macOS development.
# Mirror of setup.ps1. Not needed when running via Docker (the image installs
# Stockfish itself). Safe to re-run: exits early if ./bin/stockfish exists.
#
# Picks the official Stockfish 17 release matching this OS + CPU:
#   Linux  x86-64  → ubuntu-x86-64-avx2 (any Intel/AMD from ~2013 on)
#   Linux  arm64   → android-armv8 (static build, runs on Raspberry Pi 4/5 etc.)
#   macOS  arm64   → macos-m1-apple-silicon
#   macOS  x86-64  → macos-x86-64-avx2
# Override with STOCKFISH_ASSET=<name> (without the .tar suffix) if you have an
# older CPU, e.g. STOCKFISH_ASSET=stockfish-ubuntu-x86-64-sse41-popcnt.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bin_dir="$root/bin"
target="$bin_dir/stockfish"

if [ -x "$target" ]; then
  echo "Stockfish already present at $target"
  exit 0
fi

os=$(uname -s)
arch=$(uname -m)
case "$os/$arch" in
  Linux/x86_64)             asset=stockfish-ubuntu-x86-64-avx2 ;;
  Linux/aarch64|Linux/arm64) asset=stockfish-android-armv8 ;;
  Darwin/arm64)             asset=stockfish-macos-m1-apple-silicon ;;
  Darwin/x86_64)            asset=stockfish-macos-x86-64-avx2 ;;
  *)
    echo "Unsupported platform: $os/$arch." >&2
    echo "Install Stockfish with your package manager (apt install stockfish / brew install stockfish)" >&2
    echo "or download it from https://github.com/official-stockfish/Stockfish/releases and place it at $target" >&2
    exit 1 ;;
esac
asset=${STOCKFISH_ASSET:-$asset}

url="https://github.com/official-stockfish/Stockfish/releases/download/sf_17/$asset.tar"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/stockfish.XXXXXX")
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "Downloading Stockfish 17 ($asset)..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --retry 3 -o "$tmp/sf.tar" "$url"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$tmp/sf.tar" "$url"
else
  echo "Need curl or wget to download Stockfish." >&2
  exit 1
fi

echo "Extracting..."
tar -xf "$tmp/sf.tar" -C "$tmp"

# The tarball contains stockfish/<asset> (the executable) plus sources/docs.
exe=$(find "$tmp" -type f -name "$asset" | head -n 1)
if [ -z "$exe" ]; then
  # Fall back to any executable named stockfish* that isn't a source or text file.
  exe=$(find "$tmp" -type f -name 'stockfish*' ! -name '*.tar' ! -name '*.txt' ! -name '*.md' | head -n 1)
fi
[ -n "$exe" ] || { echo "stockfish binary not found in downloaded archive" >&2; exit 1; }

mkdir -p "$bin_dir"
mv "$exe" "$target"
chmod +x "$target"

# macOS Gatekeeper marks downloaded binaries as quarantined; clear it so the
# server can spawn it without a "cannot be opened" dialog.
if [ "$os" = Darwin ] && command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "$target" 2>/dev/null || true
fi

echo ""
echo "Stockfish installed at $target"
echo "Run 'npm install && npm run dev' to start the app."
