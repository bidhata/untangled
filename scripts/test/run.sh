#!/bin/sh
# usage: scripts/test/run.sh [name] [hostport] [image]
#   image defaults to OpenWRT 23.05.5; pass ghcr.io/openwrt/rootfs:x86_64-25.12.6
#   to run the same checks on the apk-based 25.12 line.
# Builds the app, boots a throwaway OpenWRT 23.05 router in docker and runs every
# check against it: library code over /ubus, form validation in the UI, then the
# UI regression checks. Exits non-zero if any check fails. The container is left
# running for inspection; remove it with: docker rm -f <name>
N=${1:-untangled-test}
P=${2:-18080}
IMG=${3:-ghcr.io/openwrt/rootfs:x86_64-23.05.5}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
OUT=$(mktemp -d)
cd "$ROOT" || exit 1

node -e "require.resolve('playwright-core')" 2>/dev/null || {
  echo "playwright-core is not installed. One-time setup:" >&2
  echo "  npm i --no-save playwright-core && npx playwright-core install chromium" >&2
  exit 1
}

npm run build >/dev/null || exit 1
# The same library modules the screens use, bundled for Node (mock backend off).
node_modules/.bin/esbuild "$HERE/lib-entry.ts" --bundle --platform=node --format=cjs \
  --define:import.meta.env.DEV=false --define:import.meta.env.VITE_MOCK='"false"' \
  --outfile="$OUT/lib-bundle.cjs" --log-level=warning || exit 1

sh "$HERE/router-boot.sh" "$N" "$P" "$IMG" || exit 1

fail=0
echo "--- library checks"
node "$HERE/lib-checks.cjs" "$N" "$P" "$OUT/lib-bundle.cjs" || fail=1
echo "--- form validation (UI)"
node "$HERE/ui-validation.cjs" "$N" "$P" || fail=1
echo "--- UI regression checks"
node "$HERE/ui-checks.cjs" "$N" "$P" || fail=1

[ $fail = 0 ] && echo "=== ALL CHECKS PASSED on $N ===" || echo "=== FAILURES on $N ==="
echo "container '$N' left running (http://127.0.0.1:$P/untangled/, login ut / test1234); remove with: docker rm -f $N"
exit $fail
