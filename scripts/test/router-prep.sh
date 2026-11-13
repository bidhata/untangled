#!/bin/sh
# usage (inside the container): router-prep.sh <container-ip> <gateway-ip>
# Runs inside a fresh OpenWRT rootfs container: make eth0 a real WAN that the
# docker host can reach on tcp/80+443. Needed because netifd bridges eth0 into
# br-lan on first boot and drops the address docker gave the container.
IP=${1:?container ip}
GW=${2:?gateway ip}
uci -q del_list network.@device[0].ports=eth0
uci set network.wan=interface
uci set network.wan.device=eth0
uci set network.wan.proto=static
uci set network.wan.ipaddr="$IP"
uci set network.wan.netmask=255.255.0.0
uci set network.wan.gateway="$GW"
uci add_list network.wan.dns=1.1.1.1
uci commit network
uci add firewall rule >/dev/null
uci set firewall.@rule[-1].name=test-http
uci set firewall.@rule[-1].src=wan
uci set firewall.@rule[-1].proto=tcp
uci set firewall.@rule[-1].dest_port='80 443'
uci set firewall.@rule[-1].target=ACCEPT
uci commit firewall
/etc/init.d/network restart
sleep 4
/etc/init.d/firewall restart >/dev/null 2>&1
sleep 2
mkdir -p /root/pk
