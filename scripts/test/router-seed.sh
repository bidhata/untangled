#!/bin/sh
# Runs inside the prepared test router: packages + synthetic state for the checks
# (login `ut` / test1234 limited to the untangled ACL, two fake radios, a second
# WAN, an IPv6 WAN, and a tmpfs "drive" at /mnt/usb).
# Set the password first: package install scripts add system users, and a
# passwd run that overlaps them has been seen to wait on the account-file lock.
printf 'test1234\ntest1234\n' | passwd root >/dev/null 2>&1
# opkg on 23.05 / 24.10, apk on 25.12+ and snapshot
if command -v apk >/dev/null 2>&1; then
  apk update >/dev/null 2>&1
  apk add uhttpd uhttpd-mod-ubus rpcd rpcd-mod-file rpcd-mod-luci mwan3 samba4-server ddns-scripts ddns-scripts-noip cgi-io >/dev/null 2>&1
  /etc/init.d/rpcd enable; /etc/init.d/uhttpd enable
else
  opkg update >/dev/null 2>&1
  opkg install mwan3 samba4-server ddns-scripts ddns-scripts-noip cgi-io >/dev/null 2>&1
fi
uci set rpcd.ut=login
uci set rpcd.ut.username=ut
uci set rpcd.ut.password='$p$root'
uci add_list rpcd.ut.read=untangled
uci add_list rpcd.ut.write=untangled
uci commit rpcd
uci -q set uhttpd.main.redirect_https=0
uci -q commit uhttpd
# two radios with one AP each (no real hardware: netifd just reports them down)
cat > /etc/config/wireless <<'EOT'
config wifi-device 'radio0'
	option type 'mac80211'
	option band '2g'
	option channel '1'

config wifi-device 'radio1'
	option type 'mac80211'
	option band '5g'
	option channel '36'

config wifi-iface 'default_radio0'
	option device 'radio0'
	option mode 'ap'
	option network 'lan'
	option ssid 'Home'
	option encryption 'psk2'
	option key 'homepassword'

config wifi-iface 'default_radio1'
	option device 'radio1'
	option mode 'ap'
	option network 'lan'
	option ssid 'Home'
	option encryption 'psk2'
	option key 'homepassword'
EOT
# a second WAN and an IPv6 WAN for Dual WAN / IPv6 relay
uci set network.wanb=interface
uci set network.wanb.proto=dhcp
uci set network.wanb.device=eth7
uci set network.wan6=interface
uci set network.wan6.proto=dhcpv6
uci set network.wan6.device=eth0
uci commit network
# an attached "drive"
mkdir -p /mnt/usb
mount -t tmpfs tmpfs /mnt/usb
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
sleep 2
ls /etc/config | tr '\n' ' '
echo
uci show samba4 2>/dev/null | head -5
