#!/bin/sh
# usage (inside a prepared 23.05 router): router-old.sh "<packages>"
# Installs the OLDER untangled .ipk files found in /root/pk, points opkg at the
# live signed feed (as the README does) and adds the test login (ut / test1234,
# limited to the untangled ACL). Used by update-check.sh.
wget -q -O /tmp/untangled.pub https://bidhata.github.io/untangled/keys/untangled.pub
opkg-key add /tmp/untangled.pub
echo 'src/gz untangled https://bidhata.github.io/untangled/stable' >> /etc/opkg/customfeeds.conf
opkg update >/dev/null 2>&1
for p in $1; do opkg install /root/pk/${p}_*.ipk >/dev/null 2>&1; done
printf 'test1234\ntest1234\n' | passwd root >/dev/null 2>&1
uci set rpcd.ut=login
uci set rpcd.ut.username=ut
uci set rpcd.ut.password='$p$root'
uci add_list rpcd.ut.read=untangled
uci add_list rpcd.ut.write=untangled
uci commit rpcd
uci -q set uhttpd.main.redirect_https=0
uci -q commit uhttpd
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
sleep 2
opkg list-installed | grep untangled
