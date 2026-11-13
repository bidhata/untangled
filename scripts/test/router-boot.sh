#!/bin/sh
# usage: scripts/test/router-boot.sh <name> <hostport> [image]
# Boots a real OpenWRT rootfs in docker, makes it reachable from this machine at
# http://127.0.0.1:<hostport>/untangled/, installs the CURRENT build (dist/ +
# the rpcd ACL from this tree) and seeds it for the checks (see router-seed.sh).
# Run `npm run build` first. Remove it afterwards with: docker rm -f <name>
set -e
N=${1:?container name}
P=${2:?host port}
IMG=${3:-ghcr.io/openwrt/rootfs:x86_64-23.05.5}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
[ -f "$ROOT/dist/index.html" ] || { echo "dist/ is missing: run 'npm run build' first" >&2; exit 1; }

docker run -d --name "$N" --privileged -e CMD_ENV=/sbin/init -p "127.0.0.1:$P:80" "$IMG" >/dev/null
sleep 12   # procd needs a moment to bring up ubusd/rpcd/uhttpd
IP=$(docker inspect "$N" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
GW=$(docker inspect "$N" --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}')

# /tmp inside the container is a tmpfs mounted after start, so copy into /root.
docker cp "$HERE/router-prep.sh" "$N:/root/router-prep.sh"
docker cp "$HERE/router-seed.sh" "$N:/root/router-seed.sh"
docker exec "$N" sh /root/router-prep.sh "$IP" "$GW"
docker exec "$N" mkdir -p /www/untangled
docker cp "$ROOT/dist/." "$N:/www/untangled/"
docker cp "$ROOT/openwrt/files/usr/share/rpcd/acl.d/untangled.json" "$N:/usr/share/rpcd/acl.d/"
docker cp "$ROOT/openwrt/files/www/untangled-home.html" "$N:/www/"
docker exec "$N" sh /root/router-seed.sh >/dev/null

CODE=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$P/untangled/" || true)
echo "$N ($IP) app http $CODE"
[ "$CODE" = 200 ]
