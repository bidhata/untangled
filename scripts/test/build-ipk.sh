#!/bin/sh
# usage: scripts/test/build-ipk.sh <version> <outdir>
# Builds the three .ipk packages locally with the OpenWRT 23.05 SDK, assembling
# the feed the same way .github/workflows/release.yml does. Use it before
# pushing any change to openwrt/Makefile or the package payload (~1 minute).
# Run `npm run build` first.
set -e
VER=${1:?version, e.g. 0.1.17}
OUT=${2:?output directory}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
[ -f "$ROOT/dist/index.html" ] || { echo "dist/ is missing: run 'npm run build' first" >&2; exit 1; }

FEED=$(mktemp -d)
F="$FEED/untangled"
mkdir -p "$F" "$OUT"
cp "$ROOT/openwrt/Makefile" "$F/"
cp -r "$ROOT/openwrt/files" "$ROOT/openwrt/files-full" "$ROOT/openwrt/files-mesh" "$F/"
mkdir -p "$F/files/www/untangled"
cp -r "$ROOT/dist/." "$F/files/www/untangled/"
sed -i "s/^PKG_VERSION:=.*/PKG_VERSION:=$VER/" "$F/Makefile"
chmod -R a+rX "$FEED"
chmod a+rwx "$OUT"
OUT=$(cd "$OUT" && pwd)

docker run --rm -v "$FEED:/feed:ro" -v "$OUT:/out" -v "$HERE/sdk-build-inner.sh:/sdk-build-inner.sh:ro" \
  ghcr.io/openwrt/sdk:x86_64-23.05.5 bash /sdk-build-inner.sh
ls -l "$OUT"
