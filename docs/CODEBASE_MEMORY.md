# UnTangled — Codebase Memory

Structured reference for any AI assistant working on this project. This is the
durable "what/where/why" map; the running narrative lives in `HANDOFF.md`, and
the open task of the moment is always at the **top of `HANDOFF.md`**.

Keep this file current when structure, conventions, or key decisions change.
Last updated: 2026-11-03.

---

## 1. What this project is

**UnTangled** — a modern web interface for OpenWRT (targeting latest, 24.10 /
24.10-era + 23.05 stable), meant as an easier replacement for **LuCI**. Design
goal: Asuswrt-Merlin simplicity with TP-Link-style visuals, usable by
**both non-technical home users and technical users** (enterprise-grade, but
simple default path + "Advanced details" disclosures + per-field help).

- **Owner / user:** bidhata@gmail.com
- **Author / credit:** Krish Paul <me@krishnendu.com>
- **Repo:** https://github.com/bidhata/untangled (branch `main`)
- **License:** GPL-2.0-or-later
- **Local repo dir:** `/root/bhuci` (dir name stays `bhuci`; product name is UnTangled)
- **Published site/feed:** https://bidhata.github.io/untangled/
  (`/stable` opkg feed, `/snapshot` apk feed, `/demo/` prototype, `/keys/` public keys)

Identifiers everywhere use **`untangled`**: npm name, OpenWRT package, ACL
groups `untangled`/`untangled-readonly`, rpcd helper `untangled.sw` /
`untangled.mesh`, web root `/www/untangled`, localStorage key `untangled-theme`.

---

## 2. Tech stack & build

- **Frontend:** Svelte 5 + Vite + TypeScript. SPA, client-side rendered.
- **Backend (on router):** no app server — the SPA talks to OpenWRT's existing
  `ubus` JSON-RPC over `/ubus` (via uhttpd + uhttpd-mod-ubus), plus `rpcd`
  helpers and `cgi-io` for uploads. Config is read/written via **UCI**.
- **Bundle size:** ~75 KB gz JS + ~5 KB gz CSS (the whole selling point vs LuCI's 2–4 MB).

Commands (from repo root):
- `npm install`
- `npm run build` — Vite build to `dist/`
- `npm run check` — `svelte-check` (type check). **Must pass clean before declaring done.**
- `ROUTER=<ip> npm run dev` — dev server, proxies `/ubus` to a real router
- `npm run build:gz` — build + gzip (only for an nginx front-end; uhttpd can't serve precompressed)

**Design constraints (locked by user):**
- TP-Link light + rounded = default look; dark (Merlin) theme toggle.
- **Offline-only fonts** (system stack, no web fonts — router has no internet).
- No runtime reliance on external package/update fetch beyond the on-device Software/apk screen.
- **Per-field `?` help** on every form field (`.help`/`.tip` CSS + `help(text)` helper) — this is the bridge between the non-tech and tech audiences. Use on every new field.
- Deep technical truth goes in an **"Advanced details"** `<details>` disclosure per screen.

---

## 3. Repository layout

```
/root/bhuci
├── src/                      # Svelte 5 + TS app
│   ├── App.svelte, main.ts, app.css   # app.css holds design tokens
│   ├── components/           # app shell + cross-cutting UI
│   ├── lib/                  # data/logic layer (ubus/uci wrappers, per-feature libs)
│   └── screens/              # one Svelte component per nav screen
├── public/plugins/           # runtime plugins shipped in core (ping, mesh) + index.json
├── openwrt/                  # OpenWRT packaging (Makefile, rpcd ACL, uci-defaults, mesh files)
├── feed/untangled/           # assembled package feed source (built UI + mesh files)
├── keys/                     # package-signing PUBLIC keys (private halves gitignored)
├── site/                     # landing site (index.html, logos, og.png)
├── scripts/gzip-dist.mjs     # optional gzip pass
├── docs/                     # ARCHITECTURE.md, HANDOFF.md, PLUGINS.md, this file, screenshots/
└── .github/workflows/release.yml   # CI: build packages, sign, publish feed + site
```

### Components (`src/components/`)
App shell and cross-cutting UI: `Shell.svelte` (top-level: routes id→screen
component, loads plugins onMount, hosts Toasts/ConfirmApply), `Topbar.svelte`,
`Sidebar.svelte` (plugin-aware), `CommandPalette.svelte` (⌘K: pages/actions/
devices, plugin-aware), `Login.svelte` (`session.login`), `Help.svelte`
(per-field tooltip), `Icon.svelte` + `IconSprite.svelte`, `Toasts.svelte`,
`ConfirmApply.svelte` (rollback dialog), `PluginHost.svelte` (mounts plugins).

### Lib layer (`src/lib/`)
Core plumbing:
- `ubus.ts` — ubus JSON-RPC client (`session.login`, call wrapper) + UCI helpers: `uciGet/Set/Add/Delete`, `uciApply` (commit+reload, no rollback), `uciApplyRollback(timeout)/uciConfirm/uciRollback`.
- `stores.ts` — Svelte stores: session, theme, current route.
- `nav.ts` — the sidebar nav tree (groups → items with id/label/icon). `titles` map derived from it.
- `toast.ts` — toast store (paired with `Toasts.svelte`).
- `confirm.ts` — rollback-confirm store (`startRollbackConfirm/keepChanges/revertChanges`).
- `plugins.ts` — plugin registry + `loadPlugins()` (fetch `plugins/index.json`, dynamic `import()`) + `buildNav()`.
- `pluginApi.ts` — stable `PluginAPI` v1 handed to plugins (ubus/uci, toast, navigate, getTheme).

Per-feature data libs (each paired with a screen; most degrade to an
"install &lt;pkg&gt;" card when the underlying package/uci config is absent):
`net.ts` (board/sysinfo/wan/clients), `devices.ts`, `wireless.ts`, `guest.ts`,
`firewall.ts` (zones + DMZ + port forwarding), `parental.ts`, `wan.ts`,
`lan.ts`, `ipv6.ts`, `system.ts` (hostname/tz/password/reboot/scheduled reboot),
`protection.ts` (adblock/banIP), `vpn.ts` (WireGuard + OpenVPN), `repeater.ts`
(iwinfo scan + join as sta), `software.ts` (apk via `untangled.sw`), `ddns.ts`,
`qos.ts` (sqm), `upnp.ts` (miniupnpd-nftables), `firmware.ts` (sysupgrade via
cgi-io), `dualwan.ts` (mwan3 generator), `usb.ts` (mounts + ksmbd + minidlna),
`history.ts` (vnstat + nlbwmon usage history).

### Screens (`src/screens/`)
One component per nav id. All nav items are real screens; `Placeholder.svelte`
is only a fallback. Current set: NetworkMap, Devices, GuestNetwork,
TrafficMonitor, UsageHistory, ParentalControls, ExtendWifi, NetworkProtection,
Wireless, Wan, Ddns, Qos, DualWan, Upnp, PortForwarding, Vpn, Lan, Ipv6,
Firewall, Dmz, Administration, SystemLog, UsbApps, Firmware, Software.

Nav grouping (see `nav.ts`): **General**, **Advanced Settings**, **System**.

---

## 4. OpenWRT packaging (`openwrt/Makefile`)

**Three packages from one source:**
1. `untangled` — minimal core. DEPENDS: uhttpd + uhttpd-mod-ubus + rpcd + rpcd-mod-file + rpcd-mod-luci. HTTP only.
2. `untangled-full` — meta pkg adding rpcd-mod-iwinfo + rpcd-mod-rpcsys + libustream-mbedtls + px5g + cgi-io + etherwake (Wi-Fi scan, firmware/backup, HTTPS, uploads, WoL).
3. `untangled-mesh` — mesh backend. DEPENDS: +untangled +dawn +umdns. Ships rpcd helper `untangled.mesh` + uci-defaults `92-untangled-mesh`. PKGARCH all.

On-demand packages (documented in `-full` description, not hard deps; screens
degrade to install-prompt): sqm-scripts, ddns-scripts, miniupnpd-nftables,
mwan3, ksmbd, minidlna, vnstat, nlbwmon, etherwake.

**Packaging facts (hard-won, don't relearn):**
- apk does NOT exist in stable OpenWRT (23.05 & 24.10 are **ipk-only**); real `.apk` only from the **snapshot** SDK.
- Don't pre-gzip into the package (uhttpd can't serve precompressed; squashfs/overlay already compresses).
- `PKGARCH:=all` (one set covers all stable archs).
- ACL `untangled.json`: read role must NOT include broad `file`; write `file` scoped to exec/write (+ read for crontab). Grants `untangled.mesh` methods (harmless when helper absent → NOT_FOUND → UI degrades).

---

## 5. CI / release (`.github/workflows/release.yml`)

Uses `gh-action-sdk@main`. Matrix: `x86_64-23.05.5` → .ipk + `x86_64-snapshot`
→ .apk (experimental / continue-on-error). On a `v*` tag it builds + signs +
publishes feed + site; `workflow_dispatch` redeploys the site/feed at the
latest tag's version **without cutting a new release**.

**CI facts (documented in workflow comments + `keys/README.md`):**
- `PACKAGES` must be the source dir name `untangled` (+ the others).
- `NO_SHFMT_CHECK=1` because the assembled feed isn't a git checkout.
- apk signing key MUST be **EC prime256v1** (ed25519/RSA break the build — OpenWRT derives pubkey with `openssl ec`).
- GitHub Pages must be enabled once by hand (Source = GitHub Actions), and the `github-pages` environment needs a deployment rule allowing **Tag `v*`**.

**Signing keys** (`keys/`, see `keys/README.md`):
- `untangled.pub` (usign/ed25519) verifies the opkg `Packages.sig`.
- `untangled.pem` (EC P-256) verifies `.apk` + `packages.adb`.
- Private halves are **repo secrets only**, gitignored locally: `USIGN_KEY` ← `untangled.key`, `APK_KEY` ← `untangled.key.pem`.

---

## 6. Plugin system (LuCI-style, runtime, framework-agnostic)

Plugins are self-contained ES modules shipped as static files to
`/www/untangled/plugins/`; they need **no core rebuild**. `loadPlugins()`
fetches `plugins/index.json`, dynamic-imports each module, `buildNav()` merges
them into the sidebar; `PluginHost.svelte` mounts `plugin.mount(container, api)`
for `#<id>` routes. The handed `PluginAPI` v1 (`pluginApi.ts`) exposes
ubus/uci, toast, navigate, getTheme. Docs: `docs/PLUGINS.md`. Examples:
`public/plugins/ping/ping.js`, `public/plugins/mesh/mesh.js`.

---

## 7. Mesh Wi-Fi (HYBRID: plugin frontend + package backend)

Decision: not pure plugin (plugin system is frontend-only; mesh needs
device-side orchestration), not pure core.
- **Frontend** = a plugin shipped in core (`public/plugins/mesh/mesh.js`), degrades to "install untangled-mesh" card when the `untangled.mesh` ubus object is absent.
- **Backend** = package `untangled-mesh` with jshn rpcd helper `openwrt/files-mesh/usr/libexec/rpcd/untangled.mesh`.
- Helper methods: `info/status/nodes` (read-only), `set_roaming` (adds/removes 802.11r/k/v + wifi reload), `set_role`/`join`/`leave` (phase 2, safe — persist role, match SSID/key, no bridging/DHCP changes so no lockout), `apply` (no-op stub).
- "EasyMesh-like": unified SSID + dawn roaming + wired-first/802.11s backhaul + QR/code onboarding. Join code format: base64 of `untangled-mesh|mesh_id|ssid|key`.
- busybox ash constraints: helper passes `sh -n`; `local` only inside functions.
- **Honest gaps:** both nodes must already run OpenWRT+UnTangled; NOT certified Multi-AP/prplMesh.
- **Deferred (needs 2 routers to validate):** umdns peer discovery (`nodes` still self-only), the dumb-AP bridging/DHCP-disable step (intentionally manual, documented in join message), 802.11s backhaul (+wpad-mesh dep).

---

## 8. Safety model

- **Rollback-confirm** for connectivity-risky saves (Wireless, WAN, LAN, Firewall zones, DMZ): apply with a rollback timer (`uciApplyRollback`) → "Keep changes? reverting in Ns" dialog (`ConfirmApply.svelte`). Keep → `uciConfirm`; Revert/timeout → `uciRollback` + reload.
- Safe screens (Guest, PortForwarding, Parental, Protection, VPN peers) use plain `uciApply`.
- Known caveat: an intentional LAN-IP change can't be confirmed from the old IP (router auto-reverts) — same as LuCI.
- Deliberate no-op stubs where half-built state could break a live router (mesh `set_role`/`join`/`leave`/`apply` were stubs before phase 2; `apply` still is).

---

## 9. Validation discipline (user expectation — important)

The user ships a beta to non-technical users and cares about not generating
"it broke my router" posts. Therefore:
- **Verify every shipped change in a real OpenWRT container** (docker rootfs 23.05 + snapshot): install → serve → `/ubus` login + ACL → the actual feature.
- **Watch CI and report pass/fail unprompted.**
- A command exiting 0 is NOT proof of success — verify against concrete criteria.
- The user delegates scope ("you choose", "go"), replies tersely, and when asked for options prefers a short **ponytail-style** critique (lazy-senior-dev, smallest complete change) with one recommendation, not a menu.

**Not yet validated on physical routers.** Everything shipped so far was
verified in OpenWRT docker rootfs. Hardware-dependent bits to re-check on real
gear: createGuest provisioning, apk helper (`untangled.sw`), VPN key-gen/QR
(deferred — paste pubkey for now), Extend Wi-Fi relayd bridge (deferred — joins
as client only), reboot via file.exec, password via rpcd-mod-luci, mesh
multi-node.

---

## 10. Release status & open task

- Releases v0.1.0–v0.1.7 exist (v0.1.0/v0.1.1 failed builds, v0.1.2 ipk-only). **v0.1.7 is current.**
- Feed + landing site + live demo live at https://bidhata.github.io/untangled/ .

**OPEN TASK (see top of `HANDOFF.md` for the authoritative version):** the
package feed is **unsigned**. Keys exist locally and public halves are
committed, but `USIGN_KEY`/`APK_KEY` secrets didn't reach the build jobs:
`stable/Packages.sig` is 404; `snapshot/packages.adb` + `.apk` verify as
UNTRUSTED; `/keys/` on the site is 404 (v0.1.7 tag predates the keys commit).
**Fix (owner action):** set the two **repository** secrets per `keys/README.md`,
push main, run "Release packages" by hand on main (workflow_dispatch), then
verify (`usign -V`; `opkg update` with check_signature; `apk add` without
`--allow-untrusted`). The workflow now emits `::warning::` on an unsigned feed.

**Deferred backlog:** VPN policy routing (last remaining gap); mesh phase 3;
README/demo parity for the default-page panel; reconcile Administration
divergence (prototype has backup-restore/config-profiles/undo; real app has
name/tz/password/scheduled-reboot/reboot but not those three).

**Can't match (proprietary):** AiProtection/HomeShield IPS, AiMesh/OneMesh,
port triggering (not native to OpenWRT, no fw4/nftables drop-in — replaced by
UPnP/NAT-PMP + static port forwarding).

---

## 11. Related docs

- `docs/HANDOFF.md` — running narrative + current open task (read first for "what now").
- `docs/ARCHITECTURE.md` — the build plan.
- `docs/PLUGINS.md` — plugin authoring.
- `keys/README.md` — signing key generation + repo-secret + Pages setup.
- `openwrt/README.md`, `feed/untangled/Makefile` — packaging.
