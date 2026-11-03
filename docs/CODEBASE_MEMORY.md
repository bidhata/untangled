# UnTangled — Codebase Memory

Structured reference for any AI assistant working on this project. This is the
durable "what/where/why" map; the running narrative lives in `HANDOFF.md`, and
the open task of the moment is always at the **top of `HANDOFF.md`**.

Keep this file current when structure, conventions, or key decisions change.
Last updated: 2026-11-03 (v0.1.9 released; signing done; field-report fixes + review hardening + upstream draft).

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
- **Bundle size:** ~80 KB gz JS + ~6 KB gz CSS (the whole selling point vs LuCI's 2–4 MB).

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
│   └── upstream/             # DRAFT Makefile+README for a future openwrt/packages PR (not shipped)
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
(iwinfo scan + join as sta), `tailscale.ts` (status/up/down via `tailscale` CLI
over file.exec), `software.ts` (lists installed pkgs via apk/opkg over file.exec;
install/remove path needs the unshipped `untangled.sw` helper), `ddns.ts`,
`qos.ts` (sqm), `upnp.ts` (miniupnpd-nftables), `firmware.ts` (sysupgrade via
cgi-io), `dualwan.ts` (mwan3 generator), `usb.ts` (mounts + ksmbd + minidlna),
`history.ts` (vnstat + nlbwmon usage history).

### Screens (`src/screens/`)
One component per nav id. All nav items are real screens; `Placeholder.svelte`
is only a fallback. Current set (26): NetworkMap, Devices, GuestNetwork,
TrafficMonitor, UsageHistory, ParentalControls, ExtendWifi, NetworkProtection,
Wireless, Wan, Ddns, Qos, DualWan, Upnp, PortForwarding, Vpn, Tailscale, Lan,
Ipv6, Firewall, Dmz, Administration, SystemLog, UsbApps, Firmware, Software.

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
- **Timer invariant:** `uciApplyRollback` default is **120s** (router), `startRollbackConfirm` default is **90s** (UI) — the UI countdown must stay strictly inside the router window so a last-second "Keep" lands before auto-revert.
- **confirm.ts is single-flight:** a new `startRollbackConfirm` finalizes any in-flight one first; keep/revert callbacks are captured synchronously before the `await`.
- Safe screens (Guest, PortForwarding, Parental, Protection, VPN peers, device block/reserve, ipv6, dualwan, repeater) use plain `uciApply` — these can't cut the admin's own management session, so a rollback timer (which would auto-revert a successful change) would be wrong.
- Known caveat: an intentional LAN-IP change can't be confirmed from the old IP (router auto-reverts) — same as LuCI.
- Deliberate no-op stubs where half-built state could break a live router (mesh `set_role`/`join`/`leave`/`apply` were stubs before phase 2; `apply` still is).
- **Band detection** (`net.ts`): a client is "Wired" only when the wireless subsystem actually answered and the MAC wasn't in any `iwinfo assoclist`; if wireless is unreadable it shows **Unknown**, never a false "Wired". Supports 2.4/5/6 GHz.
- **Trust-boundary validation:** cron reboot fields are clamped/validated before writing the crontab; Devices IP reservation rejects octets > 255; file.exec uses argv arrays (not shell strings), so no shell injection.

---

## 9. Validation discipline (user expectation — important)

The user ships a beta to non-technical users and cares about not generating
"it broke my router" posts. Therefore:
- **Verify every shipped change in a real OpenWRT container** (docker rootfs 23.05 + snapshot): install → serve → `/ubus` login + ACL → the actual feature.
- **Watch CI and report pass/fail unprompted.**
- A command exiting 0 is NOT proof of success — verify against concrete criteria.
- The user delegates scope ("you choose", "go"), replies tersely, and when asked for options prefers a short **ponytail-style** critique (lazy-senior-dev, smallest complete change) with one recommendation, not a menu.

**Not yet validated on physical routers.** Everything shipped so far was
verified in OpenWRT docker rootfs (install + uhttpd serving) and by
build/type-check/unit-asserts. **Live-ubus logic is NOT container-testable** (a
bare rootfs has no ubus session/radios/clients) — the real test is
`ROUTER=<ip> npm run dev`. Hardware-dependent / half-done bits to re-check:
createGuest provisioning (flagship, highest risk), Extend Wi-Fi (joins as client
only — does NOT share to LAN; UI now says so), VPN create (manage-only, no
keygen/PKI create path; UI now says so), `untangled.sw` apk install/remove
(helper not shipped — Software is view-only), Tailscale `--timeout` + field
names, reboot via file.exec, password via rpcd-mod-luci, mesh multi-node.

---

## 10. Release status

- Releases v0.1.0–v0.1.9 exist. **v0.1.9 is current and Latest.** (v0.1.0/v0.1.1 failed builds; v0.1.2 ipk-only; v0.1.7 shipped UNSIGNED.)
- Feed + landing site + live demo at https://bidhata.github.io/untangled/ .
- `main` HEAD is ahead of releases only when there are newer commits; docs-only/UI-copy changes don't need a new tag.

**SIGNING: DONE & VERIFIED (feed + release assets).** `USIGN_KEY`/`APK_KEY`
repo secrets are set. Gotcha learned: `USIGN_KEY` must be the **exact 2-line
usign key file** (comment line included) or usign fails "Failed to decode secret
key". Verified in real OpenWRT containers at **v0.1.8 and v0.1.9**:
- opkg (23.05): `usign -V` on `Packages.sig` OK; `opkg install untangled` with `check_signature` on, no `--allow-untrusted`. usign fp `ebd6eddd72aa9d25`.
- apk (snapshot): `apk verify untangled-full-<ver>.apk` = OK with `keys/untangled.pem`, UNTRUSTED without it (release-page assets, not just the feed).

**Release mechanics:** a **tag push (`v*`)** cuts a full release (builds + signed
feed + **signed release-page assets** + Pages). A **`workflow_dispatch`**
redeploys only the feed/site at the latest tag's version and **skips** the
Release job (so tagged assets are untouched). To ship new code as a release,
push a tag. The workflow emits `::warning::` on an unsigned feed.

**KNOWN GAP — snapshot apk feed layout:** current snapshot `apk` expects
`snapshot/x86_64/APKINDEX.tar.gz`; our feed publishes `snapshot/packages.adb`
(older layout), so `apk update` can't add our repo as a live source (signing is
fine — layout mismatch only). Stable/opkg (nearly all users) works end-to-end.

**Field-report fixes (from @spdixit, shipped v0.1.9):** robust Wi-Fi band
detection; blocked/applied items sorted to top of Devices + Parental lists;
Software lists real installed packages (apk/opkg) + links notable apps to their
screens; new Tailscale screen. Plus review-hardening (rollback timer race,
cron-day validation, IP octet validation, WAN dns-clear, repeater STA dedupe,
dualwan clean rewrite, confirm single-flight) and honesty-copy for Extend
Wi-Fi + VPN empty/success states.

**Deferred backlog:** VPN *create* flow (keygen/PKI); mesh phase 3 (multi-node
discovery, 802.11s backhaul, dumb-AP bridging); Extend Wi-Fi LAN sharing
(relayd); Software `untangled.sw` helper (or remove the dead write path/ACL
grants); reconcile Administration divergence (prototype has backup-restore/
config-profiles/undo; real app doesn't).

**Audience decision (locked):** **non-tech-first**. Hard-defer power-user
foot-guns: VLAN/switch (DSA port) editing, raw firewall traffic rules/custom
nftables, startup/init + raw cron editors, full LuCI parity. Lean into the
differentiators (Network Map, task flows, per-field help, rollback safety).

**Upstream (openwrt/packages):** a DRAFT Makefile+README live in
`openwrt/upstream/` — fetches a pinned release *product* tarball (prebuilt
`dist/`) because buildbots have no network. **Not submitted**; gated on hardware
validation. To use it: attach a `untangled-<ver>.tar.gz` (top-level `dist/
files/ files-mesh/ LICENSE`) to the release and fill `PKG_HASH`.

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
- `openwrt/upstream/Makefile` + `README.md` — draft for a future openwrt/packages PR.

---

## 12. Release automation credentials

A GitHub token for push + `workflow_dispatch` is stored at `/root/bhuci/.gh_token`
(gitignored — **never commit it**; a public-repo push would trigger GitHub
secret-scanning auto-revocation). To authenticate in a shell:
```sh
cd /root/bhuci && . ./.gh_token      # exports GH_TOKEN; gh + git then work
```
`gh` CLI is installed (v2.46). With the token sourced:
- push: `git push origin main`
- cut a release: `git tag vX.Y.Z <commit> && git push origin vX.Y.Z`
- redeploy feed/site without a release: `gh workflow run "Release packages" --ref main`
- watch: `gh run watch <id> --exit-status` (snapshot leg is slow, ~10 min)

**Security note:** the current token was pasted into a chat transcript, so it is
considered exposed — the owner should revoke it (GitHub → Settings → Developer
settings → Fine-grained tokens) when done and drop a fresh one into `.gh_token`.
