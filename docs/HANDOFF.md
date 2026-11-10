# UnTangled — Developer Handoff Notes

Consolidated context for anyone picking this project back up. Keep it
current: edit this file when a decision or state changes, and commit it.
Last updated: 2026-11-03.

## OPEN TASK (start here)

**Signing is DONE as of 2026-11-03 — the feed is signed and verified.** The
two repository secrets (`USIGN_KEY`, `APK_KEY`) were added; the first
`workflow_dispatch` failed because `USIGN_KEY` was malformed on paste (usign:
"Failed to decode secret key" — it needs the exact 2-line key file, comment
line included), re-pasting fixed it, and run `41657906833` published a signed
feed. Verified in real OpenWRT containers: `usign -V` on
`stable/Packages.sig` = OK; `opkg update`/`opkg install untangled` in a 23.05
rootfs with `check_signature` on and **no `--allow-untrusted`**; `apk verify`
on the snapshot `.apk` = OK with `keys/untangled.pem`, UNTRUSTED without it.
`/keys/`, `stable/Packages.sig`, `snapshot/packages.adb` all HTTP 200.

> **NOTE (2026-11-04): the signing OPEN TASK below is DONE** — v0.1.9 shipped
> signed + verified (feed AND release assets). Follow-up #1 (unsigned release
> assets) is resolved; #2 (snapshot apk layout) still stands. The next
> owner-chosen task is **hardware validation**, now that `docs/HARDWARE_MATRIX.md`
> exists to record it. See the 2026-11-04 entry at the bottom.

**Remaining follow-ups (not blocking):**
1. **Release-page assets still unsigned.** A `workflow_dispatch` redeploys the
   *feed* but skips the Release job, so the `.apk/.ipk` attached to the v0.1.7
   tag are the old unsigned builds. The live feed is signed (installs are
   fine). To sign the Release assets too, **cut a new tag** (e.g. v0.1.8).
2. **Snapshot apk feed layout mismatch.** Current snapshot `apk` expects
   `snapshot/x86_64/APKINDEX.tar.gz`; our feed publishes `snapshot/packages.adb`
   (older layout), so `apk update` can't add our repo as a live source. Signing
   is fine; this is a layout gap. Stable/opkg (nearly all users) works
   end-to-end. Fix only if snapshot users must `apk add` from the feed.

Release automation: token at `/root/bhuci/.gh_token` (gitignored); `. ./.gh_token`
then `git push` / `gh workflow run "Release packages" --ref main`.


---

**UnTangled** is a new web interface for OpenWRT (latest, 24.10), meant as an easier replacement for LuCI, modeled on Asuswrt-Merlin's simplicity with TP-Link-style visuals. User is bidhata@gmail.com. **Author/credit: Krish Paul <me@krishnendu.com>; repo https://github.com/bidhata/untangled; license GPL-2.0-or-later.** Attribution shown in a sidebar footer (prototype + app) and in package.json/Makefile/LICENSE/README.

Current state: a clickable single-file HTML **prototype** (fake data) published as a Claude artifact — slug `ed504514-a296-4d51-83b4-7affb2f6c449`, URL https://claude.ai/artifact/WJfJXrj5mkhFUuSffmWUeL . Local source: `/root/bhuci/ui-prototype/index.html`.

Design locked by user: **TP-Link light + rounded** as default look, with a **dark (Merlin) theme toggle**; **offline-only fonts** (system stack, no web fonts — router has no internet); **no reliance on external package/update fetch at runtime** beyond an on-device Software/apk screen.

Screens built real: Network Map, Wireless (+radio auto-detect), Guest, Traffic Monitor, Parental Controls, Extend Wi-Fi (consumer repeater, hides relayd), Network Protection (safety toggles → adblock/banIP/dnsmasq), VPN (WireGuard behind a QR), Port Forwarding (preset-based "open access to a device"), Internet/WAN setup wizard (live device enumeration + installed-protocol gating + Add-interface modal for WireGuard/relayd/OpenVPN/VLAN), Administration (config profiles, backup/restore, undo log), Software (apk). Cross-cutting: per-field `?` help tooltips (`.help`/`.tip` + `help()`), ⌘K command palette (pages/actions/devices), light/dark toggle. Still stubs: LAN, IPv6, Firewall, System Log.

Plan doc: `docs/ARCHITECTURE.md`. Framework decision: **Svelte 5 + Vite + TS** (chosen for bundle size). **Phase 0 scaffold built** in repo root: ubus client (`src/lib/ubus.ts`), stores/theme/route (`src/lib/stores.ts`), nav (`src/lib/nav.ts`), app shell (Shell/Topbar/Sidebar/CommandPalette ⌘K/Login/Help/Icon), placeholder screens, design tokens in `src/app.css`, OpenWRT packaging in `openwrt/` (Makefile, rpcd ACL `bhuci`/`bhuci-readonly`, uhttpd uci-defaults). `npm install && npm run build && npm run check` all pass clean; bundle ~22 KB gz JS + 3 KB gz CSS. Dev: `ROUTER=<ip> npm run dev` proxies `/ubus`. git initialized (not committed). Phase 1 started: **Network Map screen built against real ubus** — `src/lib/net.ts` (getBoard=`system board`, getSysInfo=`system info`, getWan=`network.interface dump`, getClients=`luci-rpc getHostHints`+`getDHCPLeases`+`iwinfo assoclist` for band/signal), `src/screens/NetworkMap.svelte` (tiles, SVG topology, client table, detail panel, loading/error states, 5s polling), wired in `Shell.svelte` via a route→component map. Builds/checks clean. NOT yet validated on real hardware — field shapes follow OpenWRT 23.05/24.10 docs and may need tweaks on-device (test via `ROUTER=<ip> npm run dev`). Traffic Monitor (`getDevices`=`network.device status`, per-device byte-counter deltas → live Mbps canvas chart + interface totals) and System Log (`getLog`=`log read`, filter/level/follow/copy) also built and wired in Shell. All three read-only screens done. **Phase 2 started: Wireless screen (first write path)** — `src/lib/wireless.ts` (loadWireless reads `uci get wireless`, maps wifi-device+wifi-iface into per-radio objects; saveWireless does `uci set` iface+radio → `uci commit` → `network reload`), `src/screens/Wireless.svelte` (band tabs, SSID/security/password+strength/hide/channel/htmode, per-field Help, dirty-tracking Apply/Revert). Added a toast system: `src/lib/toast.ts` + `components/Toasts.svelte` (in Shell). Builds/checks clean (~36 KB gz JS). Guest Network (`lib/guest.ts`: loadGuests/saveGuest + createGuest provisions interface+dhcp+firewall zone+SSID), Firewall (`lib/firewall.ts`: zone policy editor input/output/forward/masq + forwardings view), and DMZ (same lib: redirect named 'dmz', full WAN DNAT to a host, with caution UI + device picker) all built and wired. Added uci helpers `uciAdd`/`uciDelete`/`uciApply` (apply = commit+reload, no rollback); wireless switched to uciApply too. Toast system in place. Builds/checks clean (~40 KB gz JS). Still unvalidated on hardware — createGuest provisioning especially needs on-device verification. **ALL screens now built** (every nav item is a real component; Placeholder is only a fallback). Libs: wireless, guest, firewall (zones+DMZ+portfwd), parental (fw4 time rules by MAC), wan, lan, ipv6, system (hostname/tz/password via luci.setPassword/reboot via file.exec), protection (adblock/banip toggles), vpn (Server+Client; WireGuard interfaces/peers + OpenVPN instances; add WG peer by pubkey, import OpenVPN .ovpn via file.write, add WG client by parsing a wg-quick config; role inferred from peer endpoint), repeater (iwinfo scan + join as sta), software (apk via planned `untangled.sw` helper, degrades to "not installed"). Screens: NetworkMap, TrafficMonitor, SystemLog, Wireless, GuestNetwork, Firewall, Dmz, PortForwarding, ParentalControls, ExtendWifi, NetworkProtection, Vpn, Wan, Lan, Ipv6, Administration, Software. Toast + per-field Help throughout. Full build/check clean (~54 KB gz JS, ~5 KB gz CSS). **Nothing yet validated on hardware — this is the point to recheck via `ROUTER=<ip> npm run dev`.** Known hardware-dependent bits: createGuest provisioning, apk helper (not yet packaged), VPN key-gen/QR (deferred; paste pubkey for now), Extend Wi-Fi relayd bridge (deferred; joins as client only), reboot via file.exec, password via rpcd-mod-luci.

**Renamed Bhuci → UnTangled** everywhere (display + identifiers: npm name `untangled`, OpenWRT package `untangled`, ACL groups `untangled`/`untangled-readonly`, helper `untangled.sw`, `/www/untangled`, localStorage `untangled-theme`). Repo dir stays `/root/bhuci`. Prototype artifact republished with title UnTangled (same slug/URL).

**Plugin system built (LuCI-style, runtime, framework-agnostic)** — `src/lib/plugins.ts` (registry + `loadPlugins()` fetches `plugins/index.json`, dynamic-`import()`s each self-contained ES module, `buildNav()` merges into sidebar), `src/lib/pluginApi.ts` (stable `PluginAPI` v1: ubus/uci, toast, navigate, getTheme), `src/components/PluginHost.svelte` (mounts `plugin.mount(container, api)` for `#<id>` routes). Sidebar + CommandPalette are now plugin-aware; Shell loads plugins onMount and routes to PluginHost. Example: `public/plugins/ping/ping.js` (Tools → Ping Test via file.exec). Docs: `docs/PLUGINS.md`. Plugins ship as static files to `/www/untangled/plugins/` and need no core rebuild. Builds/checks clean (~55 KB gz JS).

**Packaging (apk for 24.10+, ipk for ≤23.05) — two tiers** from one source (`openwrt/Makefile`): `untangled` = minimal core (DEPENDS uhttpd + uhttpd-mod-ubus + rpcd + rpcd-mod-file; HTTP only) and `untangled-full` = meta adding rpcd-mod-iwinfo + rpcd-mod-rpcsys + libustream-mbedtls + px5g (Wi-Fi scan, firmware/backup, HTTPS). App payload 196 KB plain → 62 KB gz (overlay/squashfs compresses, so ~62 KB real flash). Do NOT pre-gzip into the package (uhttpd can't serve precompressed; fs already compresses). Optional `npm run build:gz` (scripts/gzip-dist.mjs) writes `.gz` only for an nginx front-end. Minimal install ≈ app + ~75 KB deps; `-full` adds up to ~300 KB (often ~0, mbedtls usually already present). Far smaller than LuCI's 2–4 MB; UI runs client-side so router RAM impact is minimal.

**Review + hardening pass done:** fixed ACL breadth (dropped `file` from read role, write `file` scoped to exec/write), added missing `+rpcd-mod-luci` dep (password change), Parental 0-days guard, removed dead `uciCommit`. **Rollback-confirm safety implemented** — `src/lib/confirm.ts` (store + startRollbackConfirm/keepChanges/revertChanges) + `components/ConfirmApply.svelte` dialog in Shell; ubus `uciApplyRollback(timeout)`/`uciConfirm`/`uciRollback`. Connectivity-risky saves (Wireless, WAN, LAN, Firewall zones, DMZ) now apply with a rollback timer and pop a "Keep changes? reverting in Ns" dialog — Keep→confirm (finalize snapshot), Revert/timeout→rollback + reload. Safe screens (Guest, PortForwarding, Parental, Protection, VPN peers) still use plain uciApply. Known: an intentional LAN-IP change can't be confirmed from the old IP (router auto-reverts) — same caveat as LuCI.

**GitHub release workflow** `.github/workflows/release.yml` (gh-action-sdk@main). CORRECTION: apk does NOT exist in any stable OpenWRT (23.05 and 24.10 are ipk-only); real `.apk` only comes from the **snapshot** SDK. Matrix is now `x86_64-23.05.5` → .ipk (one PKGARCH:=all set covers all stable) + `x86_64-snapshot` → .apk (experimental/continue-on-error). The hard-won CI facts are documented as comments in the workflow and in `keys/README.md` (PACKAGES must be the source dir `untangled`; NO_SHFMT_CHECK=1 because the assembled feed isn't a git checkout; apk signing key MUST be EC prime256v1 — ed25519 breaks the build; Pages must be enabled by hand with Source=GitHub Actions and the `github-pages` environment needs a `v*` tag rule).

**Status as of 2026-11-03:** repo is live at https://github.com/bidhata/untangled (main), releases v0.1.0–v0.1.6 exist — v0.1.0/v0.1.1 failed builds, v0.1.2 ipk-only; **v0.1.6 is current** (feed + landing site + default-page toggle). Signed package feed + landing site + live demo are published at **https://bidhata.github.io/untangled/** (`/stable` opkg feed, `/snapshot` apk feed, `/demo/` = the prototype, `/og.png`); a `workflow_dispatch` redeploys the site at the latest released version without cutting a release (proven). **Signing state (2026-11-03, v0.1.7 is current):** keys generated locally (`keys/untangled.key` usign fp ebd6eddd72aa9d25, `keys/untangled.key.pem` EC P-256; both gitignored, pairs verified consistent) and public halves committed (be3b9aa). BUT the v0.1.7 run built UNSIGNED: no `stable/Packages.sig`, and `snapshot/packages.adb` and the release .apk verify as UNTRUSTED with keys/untangled.pem installed (apk matches keys by content, so it was signed by a throwaway SDK key; note packages.adb is compressed, so grepping it for a key id proves nothing) → the `USIGN_KEY`/`APK_KEY` secrets were not visible to the build jobs (not added, misnamed, or added as github-pages *environment* secrets instead of repository secrets). Also `/keys/` on the site is 404 because the tag predates the keys commit. Fix path: user sets repository secrets, then runs the workflow by hand on main (workflow_dispatch rebuilds at the latest tag's version and redeploys feed + keys, no new tag). Verify with `verify-signed-feed` approach: usign -V on Packages.sig, opkg update in 23.05 rootfs (check_signature on), apk add in snapshot rootfs without --allow-untrusted. The workflow now emits ::warning:: when a feed is unsigned. Everything shipped was verified by installing the released packages in real OpenWRT docker rootfs (23.05 + snapshot): install, deps, HTTP serving, `/ubus` login + ACL, mesh backend, feed install over HTTPS, and the Administration "Default page" toggle (uhttpd `index_page` list; LuCI untouched, reversible). Not yet validated on physical routers. Deferred: VPN policy routing; mesh phase 3; README/demo parity for the default-page panel.

**Feature-gap batch #1 vs Merlin/TP-Link (device-centric, pure UCI) built:** new **Devices** screen (`src/lib/devices.ts` + `src/screens/Devices.svelte`, nav id `devices` under General, wired in Shell) — merges live clients + reservations + blocks by MAC so offline devices still show; per device: **Fixed IP** (static DHCP `config host` in dhcp), **Block internet** toggle (fw4 `rule` named `Block: …`, src lan→dest wan, src_mac, REJECT), **Wake-on-LAN** (file.exec etherwake→ether-wake fallback, needs etherwake pkg, degrades w/ toast). **Scheduled reboot** added to Administration (`system.ts` loadRebootSchedule/saveRebootSchedule via a marked cron line in `/etc/crontabs/root`, file.read/write + cron enable/restart). ACL updated: added `read` to `file` methods (crontab read). Build + `npm run check` clean (~62 KB gz JS). Prototype brought to parity: added **Devices** screen (nav + table w/ simulated reserve/block/wake) and, in Administration, **General** (router name + time zone), **Router password** (new/confirm + show + validation — user reported this was missing), and **Scheduled reboot** panels. Note: real-app Administration has name/tz/password/scheduled-reboot/reboot but NOT backup-restore/config-profiles/undo (prototype has those — a divergence to reconcile later). **Feature-gap batch #2 (DDNS + QoS) built:** **Dynamic DNS** (`src/lib/ddns.ts` + `src/screens/Ddns.svelte`, nav id `ddns` in Advanced) — reads `config service` from /etc/config/ddns (ddns-scripts), lists hostnames w/ enable toggle + remove, add form (provider select from DDNS_PROVIDERS, hostname, username, password → uciAdd service w/ interface=wan, ip_source=network, https, 10-min check), reloads via `/etc/init.d/ddns reload`. **QoS / Smart Queue** (`src/lib/qos.ts` + `src/screens/Qos.svelte`, nav id `qos`) — manages one `config queue` in /etc/config/sqm (sqm-scripts): enable toggle, download/upload Mbps (stored as kbit ×1000), mode piece_of_cake vs layer_cake, advanced WAN-interface field (defaults to detected getWan().device), qdisc=cake; restarts `/etc/init.d/sqm`. Both degrade to an "install &lt;pkg&gt;" card when the uci config read fails (pkg absent), same pattern as `protection`/NetworkProtection. Build/check clean (~65 KB gz JS). Prototype parity: added simulated **Dynamic DNS** and **QoS** screens + nav. **Feature-gap batch #3 (5 features) built:** (1) **UPnP** (`src/lib/upnp.ts`+`Upnp.svelte`, nav `upnp`) — miniupnpd `config upnpd` enable + secure_mode, reload miniupnpd. (2) **Firmware/sysupgrade** (`src/lib/firmware.ts`+`Firmware.svelte`, nav `firmware` in System) — uploads image to /tmp/firmware.img via **cgi-io** (`POST /cgi-bin/cgi-upload` FormData w/ sessionid), `rpc-sys upgrade_test` validate → `rpc-sys upgrade_start {keep}` flash; keep-settings toggle, brick caution, cgi-io-missing message. (3) **Dual WAN** (`src/lib/dualwan.ts`+`DualWan.svelte`, nav `dualwan`) — simplified mwan3 generator: mode off/failover/balance + primary/backup from WAN-like network interfaces; saveDualWan rewrites interface(track_ip ping 8.8.8.8/1.1.1.1)+member(metric: equal=balance, stepped=failover)+policy+catch-all rule, restart mwan3. (4) **USB Storage** (`src/lib/usb.ts`+`UsbApps.svelte`, nav `usb` in System) — mounts from /proc/mounts (file.read), SMB via ksmbd `config share` (name 'UnTangled', guest_ok), DLNA via minidlna `config minidlna` enabled+media_dir; per-service install-prompt + init restart/enable. (5) **Wireless advanced tab** — extended `wireless.ts` WifiRadio + save with country/txpower (wifi-device), roaming(ieee80211r+mobility_domain)/wmm/isolate (wifi-iface); `Wireless.svelte` got an "Advanced radio settings" `<details>`. All degrade to "install <pkg>" when the uci read fails. Build/check clean (~73 KB gz JS). **Makefile**: added `+cgi-io +etherwake` to untangled-full (firmware + WoL), and documented on-demand pkgs (sqm-scripts/ddns-scripts/miniupnpd/mwan3/ksmbd/minidlna) in its description. Prototype parity: added simulated UPnP, Dual WAN, USB, Firmware screens + Wi-Fi advanced disclosure + nav. **Port triggering investigated → WON'T BUILD:** not native on OpenWRT ever, no UCI syntax; legacy kmod-ipt-triggers not in mainline feeds; fw4/nftables (24.10 target) has no drop-in. OpenWRT's own replacements = UPnP/NAT-PMP (have it) + static port forwarding (have it). Dropped from backlog. Fixed UPnP hint to name the correct package **`miniupnpd-nftables`** (not plain miniupnpd) and added a "this replaces old-style port triggering" note (real app Upnp.svelte + prototype).

**Mesh Wi-Fi started as a HYBRID (decision: not pure plugin, not pure core).** Rationale: the plugin system is frontend-only, but mesh needs device-side orchestration + multi-node coordination → backend must be a package. So: **frontend = a plugin shipped in core** (`public/plugins/mesh/mesh.js`, listed in `public/plugins/index.json`; group General, degrades to "install untangled-mesh" card when the `untangled.mesh` ubus object is absent; only live write is a seamless-roaming toggle which leaves SSID/key untouched = no lockout; shows node list + a join code + guided "add another router" steps). **backend = new package `untangled-mesh`** (`openwrt/Makefile` 3rd package, DEPENDS +untangled +dawn +umdns, PKGARCH all) shipping a jshn-based rpcd helper `openwrt/files-mesh/usr/libexec/rpcd/untangled.mesh` (methods: info/status/nodes read-only; set_roaming adds/removes 802.11r/k/v on AP ifaces + wifi reload; set_role/join/leave/apply are deliberate no-op "planned" stubs so a half-built mesh can't break a live router) + uci-defaults `92-untangled-mesh` (creates /etc/config/untangled 'mesh' section, enables dawn/umdns, reloads rpcd). Core ACL `untangled.json` grants `untangled.mesh` (read info/status/nodes; write set_roaming/set_role/join/leave/apply) — harmless when helper absent (NOT_FOUND → UI degrades). Release workflow PACKAGES now includes untangled-mesh. "EasyMesh-like" = unified SSID + dawn roaming + wired(first)/802.11s backhaul + QR/code onboarding; honest gaps vs TP-Link: both nodes must already run OpenWRT+UnTangled, and this is NOT certified Multi-AP/prplMesh. Helpers pass `sh -n`; `local` kept only inside functions (busybox ash). Build/check clean (~73 KB gz JS; mesh.js copied to dist/plugins/). Prototype got a simulated Mesh Wi-Fi screen (installed state) + nav. **Mesh phase 2 built (safe subset):** helper `set_role` (persist role+backhaul to untangled.mesh; controller also enables roaming via `_match_wifi`), `join` (base64-decode join code `untangled-mesh|mesh_id|ssid|key`, set role=agent + match AP SSID/key + roaming via `_match_wifi`, commit wireless + wifi reload — does NOT bridge/disable DHCP, so no lockout; returns a message telling user to wire up + set AP mode on LAN screen), `leave` (role=standalone). Added functions `_match_wifi`/`_set_state`. Join-code parse tested in sh (handles empty + real key). Plugin UI now has a **Role** panel (Make main / Leave mesh), controller-only **Add another router** (join code + copy), and **Join an existing mesh** (paste code → join); handlers call set_role/leave/join live. Prototype mesh screen updated to match (role + join panels). mesh.js `node --check` OK; build clean. **STILL deferred (needs 2 routers to validate):** umdns peer discovery in `nodes` (still self-only), the dumb-AP network bridging/DHCP-disable step (intentionally manual, documented in join message), wireless 802.11s backhaul (+wpad-mesh dep). **Traffic/Usage history built:** `src/lib/history.ts` (loadVnstat parses `vnstat --json` → today/month totals + daily/monthly series for the WAN iface; loadPerDevice parses `nlbw -c json -g ip,mac -o rx_bytes` → per-device rows, names merged from getClients) + `src/screens/UsageHistory.svelte` (nav id `usage`, next to Traffic Monitor) with dependency-free inline SVG bar chart (Daily/Monthly seg) + per-device table; each source degrades independently to an "install vnstat"/"install nlbwmon" card. Both read-only via file.exec. Build/check clean (~75 KB gz JS). Prototype got a simulated Usage History screen (JS-built chart) + nav. Makefile description lists vnstat+nlbwmon as on-demand. **Deferred gap backlog**: VPN policy routing (last item). Can't match (proprietary): AiProtection/HomeShield IPS, AiMesh/OneMesh.

Architecture plan for the real build: reuse UCI + ubus + rpcd + uhttpd; the SPA talks to `/ubus` JSON-RPC with `session.login`. Devices enumerate from `ubus network.device` (+ hotplug), radios from iwinfo, and virtual/VPN/relay interfaces are created (gated on installed proto handler packages). See `bhuci-nontech-simplicity`.

---

The user (bidhata@gmail.com, UnTangled owner) delegates design/scope decisions ("you choose", "go", "do it") and replies tersely; when I presented options via AskUserQuestion they asked for a **ponytail critique** (lazy-senior-dev, smallest complete change) rather than a menu, then said "go". They consistently want features **proven on real OpenWRT** (docker rootfs 23.05 / snapshot) before anything is declared working, and expect me to watch CI and report pass/fail unprompted.

**Why:** They are shipping a beta to non-technical users and care about not generating "it broke my router" posts; verification on real containers caught several CI/packaging bugs that guesses would have missed.

**How to apply:** Pick a recommendation and proceed instead of asking; when a scope choice is genuinely theirs, give a short ponytail-style critique with one recommendation. Verify every shipped change in a real OpenWRT container (install → serve → `/ubus` → feature) and in CI before reporting done. Keep replies short; report outcomes plainly. See `bhuci-nontech-simplicity` and `bhuci-project`.

---

For `bhuci-project`, the audience is **both non-technical home users AND technical users** — an **enterprise-grade** interface that works for everyone.

**Why:** User first said "users are non-tech people," then refined it: "it should be like enterprise interface, my users are non techies as well as techies. There should be hovering help for each field."

**How to apply:**
- Default path stays simple and task-based (hide relayd/WDS/proto/kmod/subnet jargon behind flows like "Extend Wi-Fi", "Open access to a device"). Sensible defaults, one decision per screen, reassuring success states.
- Serve techies too: keep full control reachable, and put deep technical truth in an **"Advanced details"** disclosure on each screen.
- **Per-field help:** every form field gets a small `?` beside its label; on hover/focus it shows a plain-language tooltip. Reusable `.help`/`.tip` CSS component + a `help(text)` JS helper build the markup. This is the bridge between the two audiences — use it on every new form field.


---

**2026-11-04 — SQM copy fix + hardware/roaming matrix (docs/UI-copy only, no release).**
Prompted by a field-knowledgeable user note (networking pro) covering four
areas. Validated each against the actual code, then made the two smallest
high-value changes and recorded decisions for the rest.

- **SQM/cake — "measured, not plan" copy fix.** `src/screens/Qos.svelte` field
  labels are now "Measured download/upload speed" (were bare "Download/Upload
  speed"), plus an always-visible hint ("use a real speed test, not the plan you
  pay for; set a bit below the result") so the warning lands without opening the
  `?`. Tooltips now say ~90–95% down / **~85–90% up** (upload is the dominant
  factor for call/gaming lag and wants a tighter margin). `src/lib/qos.ts`
  comments corrected from "plan rates" → measured rates. **Why it matters:** if
  users type the sticker/marketing speed, cake shapes above the real line rate
  and polices the wrong queue — bufferbloat comes back and SQM looks broken.
  DO NOT "simplify" these labels back to "Download speed". `svelte-check` clean.
  Not yet wired (deferred, low priority): `diffserv4` + per-host fairness
  (`nat dual-dsthost`/`dual-srchost`) for the NAT-gateway case — would go behind
  the existing "Advanced details" disclosure, not the default path.

- **Hardware/roaming support matrix — new `docs/HARDWARE_MATRIX.md`**
  (cross-referenced from CODEBASE_MEMORY §11). Tables: roaming (802.11k/v/r) per
  driver, mesh, and a **Known-broken** section. Seeded with the real driver
  families (`ath9k`/`ath10k`(-ct)/`ath11k`/`mt76`) and both target releases
  (23.05, 24.10). Everything starts ❔ **untested** — honest, since nothing is
  hardware-validated yet, and gives field reporters (e.g. @spdixit) one
  greppable place to file results. File-a-result steps point at
  `ROUTER=<ip> npm run dev` (live ubus; containers have no radios).

- **DECISION — 802.11r (FT) stays opt-in; 802.11k/v are the safe default.**
  k (neighbor reports) + v (BSS transition) give most of the roaming benefit
  with far less driver/client breakage; FT can validate clean in config and
  still break roaming on specific driver+client combos. **Known divergence held
  deliberately:** the mesh helper (`untangled.mesh` `set_roaming` /
  `set_role controller`) currently flips `ieee80211r='1'` *together* with k/v.
  Leaving that as-is on purpose until ≥2 boards are in the matrix — do NOT
  "fix" it either way (not silently-on, not ripped out) without hardware data.
  It is already conservative: `ft_over_ds='0'` + `ft_psk_generate_local='1'`,
  and it never touches SSID/key so it can't lock out the admin.

- **DECISION — rollback-confirm is the locked keeper feature.** The owner would
  keep auto-rollback over everything else; it's the Junos `commit confirmed` /
  IOS-XE revert-timer muscle memory. Hard invariant to preserve: router timer
  (120s, `uciApplyRollback`) must stay LONGER than the UI countdown (90s,
  `startRollbackConfirm`), and "Keep" must round-trip over the same path the
  change can break (that round-trip IS the connectivity proof). See CODEBASE
  §8. Don't narrow which saves arm it (Wireless/WAN/LAN/Firewall zones/DMZ)
  without re-deriving the lockout reasoning.

- **CONFIRMED-right, no change:** LuCI stays side-by-side at `/` (new UI under
  `/www/untangled`) — the escape hatch if the new UI wedges; pairs with
  rollback. Keep it through beta; no hard cutover.
---

**2026-11-05 — field-report fixes from u/venkatx5 (Reddit). Code on `main`, NOT yet tagged/released.**
Seven install-feedback items. Audited each against the actual source before
touching anything (two were missing features, not bugs; one claim I could not
fully root-cause without hardware — flagged honestly). Smallest-complete-change
discipline throughout; `svelte-check` + `vite build` clean.

- **Block-internet + Parental Controls "didn't block" — THE key bug.** Both
  write an fw4 `config rule` then applied via bare `uci apply`, which does not
  reliably rebuild the nftables ruleset for an added/removed rule — so the rule
  existed in UCI but nftables never changed. Fixed once in shared code: new
  `firewallApply(rollback?, timeout?)` in `src/lib/ubus.ts` runs the apply then
  `/etc/init.d/firewall reload`, matching how usb/system/ddns already kick their
  services. Wired into every firewall-config write: `devices.setBlocked`, all of
  `parental.ts`, and `firewall.ts` (zones/DMZ keep `rollback=true`). See
  CODEBASE §8. **Unverified on hardware** — if a given build's `uci apply`
  already triggered fw4, the extra reload is a harmless redundant reload.

- **Samba4 not detected.** `usb.ts loadSmb` only read the `ksmbd` uci config;
  now `loadSmbFrom` probes `ksmbd` then `samba` (samba4). Writes still target
  ksmbd (unchanged).

- **No device rename.** New `renameDevice()` writes the dhcp host `name`
  (creates a host entry if there's no reservation). Devices table: ✎ on hover →
  inline edit → Save. Was a genuinely missing feature, not a bug.

- **AdGuard Home not detected.** Added `adguardhome` uci detection to
  `protection.ts`. AGH runs its own daemon + web UI, so it is surfaced as an
  "Open ›" link to `:3000` (new optional `Feature.link`), NOT a UCI toggle that
  couldn't actually control it. Port 3000 assumed (AGH default); wrong if moved.

- **No "create firewall rule".** Firewall screen only edited zone policies.
  Added generic `config rule` CRUD (`loadRules/addRule/saveRule/deleteRule`,
  excludes `Block:`/`Parental:` rules owned by other screens) + a Traffic-rules
  panel: name, from→to zone, proto, dest port, action, and optional source
  match (MAC/IP/src port). **This amends the "hard-defer raw firewall rules"
  line in CODEBASE §10** — kept it plain-language, NOT raw nftables (that defer
  still stands). No inline MAC/IP format validation yet (uci rejects at apply).

- **No config backup.** Firmware screen now has Download backup
  (`sysupgrade -b` → cgi-download) + Restore (cgi-upload → `sysupgrade -r` →
  reboot), in `src/lib/firmware.ts`. **Closes the "Administration backup-restore
  divergence" backlog item** (built on Firmware, where the complaint was filed).
  Needs cgi-io (already in `untangled-full`). **Unverified on hardware.**

- **Software "install untangled-full" dead-end.** The message told a user who
  already had `untangled-full` to install it. Now names the real cause
  (package manager/ACL/`file.exec`) and tries both `apk list --installed` and
  `apk list -I` before falling back to opkg. Root cause of *why* apk returned
  nothing on the reporter's box is still unconfirmed (needs the device).

- **Credited u/venkatx5 in README** Credits, beside @spdixit.

- **Still NOT validated on a real router.** The three behavioural fixes (fw4
  reload, backup/restore, AGH link) are the ones to confirm first via
  `ROUTER=<ip> npm run dev`: block a device then check `nft list ruleset`;
  download+restore a backup; confirm AGH port.

**Status as of 2026-11-10:** v0.1.12 released (CI green, 6 assets); feed at bidhata.github.io/untangled is **signed** (`stable/Packages.sig` by key ebd6eddd72aa9d25 = local usign key) — the v0.1.7 signing problem is resolved. In response to a public critique (ACL too broad, no default HTTPS, "blindly import signing key"): the rpcd ACL is now **path-scoped** (exact file paths + exact command lines for every `file` grant, `cgi-io` upload/download scopes added — these were missing, so firmware upload/backup download could not have worked; read-only role has no `file` and `uci` limited to `system`; `rpc-sys` limited to the 3 upgrade methods), `untangled-full` ships `91-untangled-https` (redirect_https=1, guarded on listen_https), and `docs/SECURITY.md` documents the model. Verified on 23.05 + snapshot rootfs containers with `scripts/acl-probe.sh` (allow-list passes, `/bin/sh`, `/etc/shadow`, traversal, flag injection, non-granted init scripts all denied; HTTP 307→https confirmed). Gotcha: newer rpcd realpath()s read/write paths before the ACL check, so `/proc/mounts` needs a `/proc/*/mounts` grant. Not yet released (next tag 0.1.13).

**Also in 0.1.13 (field report from a Jio user):** WAN showed the CGNAT 10.122.x.x address → Network Map now detects private/CGNAT WAN, shows the browser-resolved public IP and a plain-language carrier-NAT note. All devices showed connection type Unknown → band detection now uses `hostapd.<ifname> get_clients` (works on the core package, no rpcd-mod-iwinfo) with `iwinfo` as fallback, and the UI prints the failure reason when it still can't classify. Tailscale tab claimed "not installed" → the real ubus error is now shown (most likely the binary isn't in rpcd's PATH, or tailscaled isn't running). hostapd path verified only against the known `get_clients` shape + ACL gate, NOT on Wi-Fi hardware yet.
