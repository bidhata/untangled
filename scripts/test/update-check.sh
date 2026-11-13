#!/bin/sh
# usage: scripts/test/update-check.sh [name] [hostport]
# Proves the "Update now" button for real: packages the CURRENT code as an old
# version (0.0.1), installs it on a fresh OpenWRT 23.05 router that has the live
# signed feed configured, then clicks Check -> Update now in a browser and
# verifies the router and the page both end up on the feed's version.
# Needs internet (the live feed). Remove the router after: docker rm -f <name>
N=${1:-untangled-update}
P=${2:-18081}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PK=$(mktemp -d)
cd "$ROOT" || exit 1

node -e "require.resolve('playwright-core')" 2>/dev/null || {
  echo "playwright-core is not installed: npm i --no-save playwright-core && npx playwright-core install chromium" >&2
  exit 1
}

npm run build >/dev/null || exit 1
sh "$HERE/build-ipk.sh" 0.0.1 "$PK" >/dev/null || exit 1

docker run -d --name "$N" --privileged -e CMD_ENV=/sbin/init -p "127.0.0.1:$P:80" ghcr.io/openwrt/rootfs:x86_64-23.05.5 >/dev/null || exit 1
sleep 12
IP=$(docker inspect "$N" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
GW=$(docker inspect "$N" --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}')
docker cp "$HERE/router-prep.sh" "$N:/root/"
docker cp "$HERE/router-old.sh" "$N:/root/"
docker exec "$N" sh /root/router-prep.sh "$IP" "$GW"
docker exec "$N" mkdir -p /root/pk
docker cp "$PK/." "$N:/root/pk/"
# Core + mesh only: untangled-full turns on the HTTPS redirect, which needs the
# test to browse over HTTPS (SCHEME=https and a published 443) instead.
docker exec "$N" sh /root/router-old.sh "untangled untangled-mesh"

node "$HERE/ui-update.cjs" "$N" "$P" upgrade
rc=$?
echo "container '$N' left running; remove with: docker rm -f $N"
exit $rc
