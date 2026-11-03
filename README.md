<div align="center">

# UnTangled

### A modern web interface for OpenWRT — the easy way to run your router.

An alternative to LuCI with the simplicity of Asuswrt-Merlin and the polish of a TP-Link UI.
Built for **everyone**: task-based flows for the whole household, full depth and a ⌘K command palette for the tinkerers.

![License](https://img.shields.io/badge/license-GPL--2.0--or--later-blue)
![OpenWRT](https://img.shields.io/badge/OpenWRT-23.05%20%E2%80%93%2024.10-00B5E2)
![Built with Svelte 5](https://img.shields.io/badge/built%20with-Svelte%205-FF3E00)
![UI bundle](https://img.shields.io/badge/UI%20bundle-~75%20KB%20gz-2ea44f)
![status](https://img.shields.io/badge/status-beta-orange)

<img src="docs/screenshots/network-map.png" alt="UnTangled — Network Map" width="860">

</div>

---

## Why UnTangled?

LuCI is powerful but dense. Merlin is friendly but Asus-only. **UnTangled gives any OpenWRT router a clean, approachable UI** without giving up control:

- 🧭 **Dual-audience by design** — a visual Network Map and plain-language toggles for non-technical users; every advanced knob, a command palette, and "Advanced details" disclosures for the technical ones.
- ❓ **Per-field help everywhere** — a `?` beside each setting explains it in a sentence. No jargon walls.
- 🎨 **Light & dark** — a clean light theme by default, a Merlin-style dark theme one click away.
- 🔌 **Offline-first** — system fonts, no CDNs, no web fonts, no cloud. The router never needs the internet to serve the UI.
- 🪶 **Tiny** — the whole UI is ~75 KB gzipped, versus LuCI's multiple megabytes. It reuses the OpenWRT backend (UCI + ubus + rpcd + uhttpd) — UnTangled is *just the UI*.
- 🛟 **Safe by default** — connectivity-risky changes (Wireless, WAN, LAN, Firewall, DMZ) apply with an **auto-rollback timer**: if a change would lock you out, the router quietly reverts it.
- 🧩 **Extensible** — a LuCI-style runtime plugin system lets packages add screens without rebuilding the core.

---

## A look around

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/devices.png" alt="Devices"><br><b>Devices</b> — reserve a fixed IP, block a device's internet, or wake it on LAN.</td>
    <td width="50%"><img src="docs/screenshots/mesh.png" alt="Mesh Wi-Fi"><br><b>Mesh Wi-Fi</b> — one Wi-Fi name across routers with seamless roaming (a plugin).</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/wireless.png" alt="Wireless"><br><b>Wireless</b> — SSID, security and channels up front; power, fast-roaming and WMM under Advanced.</td>
    <td width="50%"><img src="docs/screenshots/usage-history.png" alt="Usage History"><br><b>Usage History</b> — daily/monthly internet use and per-device totals.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/parental.png" alt="Parental Controls"><br><b>Parental Controls</b> — per-device internet schedules by the week.</td>
    <td width="50%"><img src="docs/screenshots/qos.png" alt="QoS"><br><b>QoS (Smart Queue)</b> — kill bufferbloat; keep calls and gaming smooth.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/vpn.png" alt="VPN"><br><b>VPN</b> — WireGuard &amp; OpenVPN, server <em>and</em> client (dark theme).</td>
    <td width="50%"><img src="docs/screenshots/firewall.png" alt="Firewall"><br><b>Firewall</b> — zone policies in plain terms, fw4/nftables under the hood (dark theme).</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/command-palette.png" alt="Command palette"><br><b>⌘K command palette</b> — jump to any page, device or action in a keystroke.</td>
    <td width="50%"><img src="docs/screenshots/firmware.png" alt="Firmware"><br><b>Firmware</b> — upload, verify, and flash a sysupgrade image, keeping your settings.</td>
  </tr>
</table>

> 🖼️ The screenshots above are rendered from the clickable UX prototype in [`ui-prototype/`](ui-prototype/index.html) with sample data.

---

## Features

**Home & devices**
Network Map · Devices (fixed IP / block / Wake-on-LAN) · Mesh Wi-Fi · Guest Network · Traffic Monitor · Usage History · Parental Controls · Extend Wi-Fi (repeater) · Network Protection (ad/threat blocking)

**Connectivity**
Wireless (+ advanced radio tab) · Internet/WAN setup wizard · Dynamic DNS · QoS / Smart Queue · Dual WAN (failover & load-balance) · UPnP · Port Forwarding · VPN — WireGuard + OpenVPN, server + client · LAN · IPv6

**Security & system**
Firewall (zones) · DMZ · Administration (hostname, time, password, scheduled reboot, backup/restore) · System Log · USB Storage (SMB + DLNA) · Firmware upgrade · Software (apk/opkg)

**Throughout**
Per-field `?` help · ⌘K command palette · light/dark themes · rollback-confirm safety on risky changes · runtime plugin system

Many advanced features light up only when their OpenWRT package is present and **degrade gracefully** — each shows an "install *package*" hint instead of an error when it isn't.

---

## Install on OpenWRT

Three packages are built from one source — install the tier you want:

| Package | What you get |
|---|---|
| `untangled` | Core UI + `/ubus` + session auth. HTTP-only, minimal. |
| `untangled-full` | Core **+** HTTPS, Wi-Fi scan, firmware upgrade, Wake-on-LAN. |
| `untangled-mesh` | Mesh Wi-Fi backend (dawn roaming + discovery). |

**Recommended — the signed package feed.** Add it once; then UnTangled installs and upgrades like any other OpenWRT package. Packages and the index are signed and verified by your router automatically.

```sh
# Stable OpenWRT (23.05 & 24.10) — opkg
wget -O /tmp/untangled.pub https://bidhata.github.io/untangled/keys/untangled.pub && opkg-key add /tmp/untangled.pub
echo 'src/gz untangled https://bidhata.github.io/untangled/stable' >> /etc/opkg/customfeeds.conf
opkg update && opkg install untangled-full

# OpenWRT snapshot — apk
wget -O /etc/apk/keys/untangled.pem https://bidhata.github.io/untangled/keys/untangled.pem
echo 'https://bidhata.github.io/untangled/snapshot/packages.adb' > /etc/apk/repositories.d/untangled.list
apk update && apk add untangled-full
```

Full feed instructions and the public keys live at **<https://bidhata.github.io/untangled/>**.

**Manual alternative:** every release also attaches raw `.ipk` (stable) and `.apk` (snapshot) files on the [GitHub Releases](https://github.com/bidhata/untangled/releases) page (`opkg install ./untangled-full_*.ipk`; for apk, trust the key first or pass `--allow-untrusted`). The package is architecture-independent (`PKGARCH:=all`), so one `.ipk` set covers every current stable release; apk is used only by OpenWRT **snapshot**.

Then grant your admin login the `untangled` ACL group and browse to `http://<router>/untangled/`. UnTangled runs alongside LuCI without touching it. Full steps, size table and HTTPS setup are in **[`openwrt/README.md`](openwrt/README.md)**.

---

## Develop

```sh
npm install
npm run dev                      # http://localhost:5173
ROUTER=192.168.1.1 npm run dev   # proxy /ubus to a real router for live data
npm run check                    # svelte-check / TypeScript
npm run build                    # -> dist/
```

**Stack:** Svelte 5 + Vite + TypeScript. The SPA talks to `/ubus` (JSON-RPC over HTTP) with `session.login`; data comes from `ubus`, `luci-rpc`, `iwinfo` and `uci`. Architecture, the per-screen data-source map, and the plugin contract are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/PLUGINS.md`](docs/PLUGINS.md).

```
src/
  lib/        ubus client, per-feature data layers (wireless, firewall, vpn, …)
  components/ Shell, Topbar, Sidebar, CommandPalette, Help, plugin host, …
  screens/    one Svelte component per nav item
public/plugins/  runtime plugins (e.g. Mesh Wi-Fi, Ping) + manifest
openwrt/    packaging: Makefile (3 packages), rpcd ACLs, uci-defaults
ui-prototype/    the clickable UX prototype (visual source of truth)
```

### Writing a plugin

A plugin is a self-contained ES module dropped into `/www/untangled/plugins/`. It adds a nav entry and screen at runtime — no core rebuild — using a small stable API (`ubus`, `toast`, `navigate`, `getTheme`). See [`docs/PLUGINS.md`](docs/PLUGINS.md) and the examples in [`public/plugins/`](public/plugins/).

---

## Status

UnTangled is in **beta**. The code is written to documented OpenWRT UCI/ubus/fw4 shapes and the UI, build and type-checks are clean — but it has **not yet been validated on physical hardware**. Treat the first releases accordingly, and please file issues with what you find on real devices.

## Credits

Developed by **Krish Paul** · <me@krishnendu.com>
Source: <https://github.com/bidhata/untangled> · Licensed **GPL-2.0-or-later**.
