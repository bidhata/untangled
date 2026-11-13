#!/bin/sh
# Runs inside a prepared OpenWRT 23.05 rootfs (see router-prep.sh): install from
# the published signed feed exactly as the README says, signature checking on.
# Use after a release to prove the feed installs on a stock image.
wget -q -O /tmp/untangled.pub https://bidhata.github.io/untangled/keys/untangled.pub
opkg-key add /tmp/untangled.pub
echo 'src/gz untangled https://bidhata.github.io/untangled/stable' >> /etc/opkg/customfeeds.conf
grep -c check_signature /etc/opkg.conf
opkg update 2>&1 | grep -E "untangled|Signature|rror"
opkg install untangled-full untangled-mesh 2>&1 | grep -E "Configuring untangled|rror|Cannot|satisf|untrusted"
opkg list-installed | grep untangled
sleep 3
echo "redirect_https=$(uci -q get uhttpd.main.redirect_https)"
ubus list untangled.mesh
echo '{}' | /usr/libexec/rpcd/untangled.mesh call status | cut -c1-110
grep -c '"revert"' /usr/share/rpcd/acl.d/untangled.json
