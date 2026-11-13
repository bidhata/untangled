# Tests against a real OpenWRT image

These scripts check UnTangled against a real OpenWRT root filesystem running in
docker (procd, ubusd, rpcd, uhttpd, fw4 — the real services, not a mock). They
are run by hand before a release; CI does not run them.

## One-time setup

```sh
docker pull ghcr.io/openwrt/rootfs:x86_64-23.05.5
npm i --no-save playwright-core && npx playwright-core install chromium
```

## Run everything

```sh
scripts/test/run.sh                 # container "untangled-test" on port 18080
scripts/test/run.sh mybox 18090     # or pick a name and port
docker rm -f untangled-test         # when done
```

`run.sh` builds the app, boots a fresh router, and runs three suites. It exits
non-zero if any check fails and leaves the container running so you can look
(`http://127.0.0.1:18080/untangled/`, login `ut` / `test1234`).

| Suite | What it does |
|---|---|
| `lib-checks.cjs` | Calls the app's own library code (`src/lib`, bundled for Node via `lib-entry.ts`) against the router's `/ubus`, then reads the result back with `uci`, `fw4`, `mwan3`. Covers Extend Wi-Fi config + rollback, WireGuard client, Dual WAN, IPv6 relay, SMB sharing, input validators. |
| `ui-validation.cjs` | Drives the real UI in headless Chromium: LAN, WAN and port-forward forms refuse bad input; the Extend Wi-Fi screen reports a failed scan cleanly. |
| `ui-checks.cjs` | UI regressions: session restore, scheduled reboot file, time zone, config backup download, failed-save isolation, USB sharing guard, DDNS provider, Network Doctor, logout. Runs last: it removes `dhcp.lan` to force a failed save and restarts rpcd. |

## Other scripts

- `router-boot.sh <name> <port> [image]` — just boot and seed a router with the
  current `dist/` (what `run.sh` uses). Handy for poking at a screen by hand.
- `router-prep.sh`, `router-seed.sh` — run inside the container by
  `router-boot.sh`: networking so the host can reach it, then packages and
  synthetic state (two fake radios, a second WAN, an IPv6 WAN, a tmpfs "drive").
- `build-ipk.sh <version> <outdir>` — build the real `.ipk` packages with the
  OpenWRT SDK, the way the release workflow does. Run it before pushing a change
  to `openwrt/Makefile` or the package payload, then `opkg install` the result
  in a booted router.
- `feed-install.sh` — run inside a prepared router after a release to prove the
  published signed feed installs on a stock image:
  `docker cp scripts/test/feed-install.sh <name>:/root/ && docker exec <name> sh /root/feed-install.sh`
- `../acl-probe.sh <name>` — the rpcd ACL allow/deny suite. It logs in with an
  empty root password, so run it on a router whose root password is unset
  (`docker exec <name> passwd -d root`).

## What this cannot cover

The container has no Wi-Fi hardware and one real uplink. Scanning and joining a
network, roaming, mesh between two routers, mwan3 failover between two live
connections, and IPv6 relay with a real ISP prefix still need a physical router
(`ROUTER=<ip> npm run dev`).

Things worth knowing when adding checks:

- netifd bridges the container's `eth0` into `br-lan` on first boot and drops
  docker's address; `router-prep.sh` turns `eth0` into a static `wan` instead.
- `docker cp` into the container's `/tmp` is lost (tmpfs); copy into `/root`.
- A DMZ rule sends all inbound WAN traffic elsewhere, which here includes your
  own connection to the test router. Remove it with `docker exec`.
- `grep -c` exits 1 on a zero count; the suites append `; true` to every command.
