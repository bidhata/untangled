#!/bin/sh
# Runs inside a prepared OpenWRT 25.12+ or snapshot router (see router-prep.sh):
# install from the published signed apk feed exactly as the README says, with
# signature checking on. Use after a release to prove the feed installs.
wget -q -O /etc/apk/keys/untangled.pem https://bidhata.github.io/untangled/keys/untangled.pem
echo 'https://bidhata.github.io/untangled/snapshot/packages.adb' > /etc/apk/repositories.d/untangled.list
grep -h VERSION= /etc/os-release | head -1
apk update 2>&1 | tail -1
apk add untangled-full untangled-mesh 2>&1 | grep -E "untangled|ERROR|WARNING|OK:" | tail -8
apk list -I 2>/dev/null | grep '^untangled'
sleep 3
echo "redirect_https=$(uci -q get uhttpd.main.redirect_https)"
ubus list untangled.mesh
echo '{}' | /usr/libexec/rpcd/untangled.mesh call status | cut -c1-110
