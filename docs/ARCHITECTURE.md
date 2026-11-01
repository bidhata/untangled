# UnTangled — Architecture & Build Plan

*A modern web interface for OpenWRT, as an easier alternative to LuCI. Modeled on Asuswrt-Merlin's simplicity with a TP-Link-style, enterprise-grade feel. Serves both non-technical and technical users.*

Status: prototype validated (see `ui-prototype/index.html`, published artifact). This doc plans the real on-device build.
Target platform: OpenWRT 24.10 (apk, nftables firewall, netifd/ubus).

---

## 1. Goals and non-goals

**Goals**
- A single interface a non-technical user can operate by task ("Extend Wi-Fi", "Open access to a device") and a technical user can drive fully (every setting reachable, Advanced-details disclosures, command palette).
- Runs entirely on-device, **offline** — no cloud account, no external font/asset/script fetch at runtime (the router often has no outbound internet during setup).
- Small enough to fit typical router flash/RAM and coexist with (or replace) LuCI.
- Extensible: new protocols/features (WireGuard, relayd, QMI, …) add their own screens by installing a package, exactly as LuCI's `luci-proto-*` plugins do.

**Non-goals (v1)**
- Replacing the OpenWRT backend. We reuse UCI + ubus + rpcd + uhttpd unchanged.
- Proprietary Merlin/Asus features (Trend Micro AiProtection, Broadcom HW accel UI). We map to OpenWRT equivalents (banIP, adblock, SQM/cake, nftables flow offload) where they exist.
- Fleet/multi-router management (tracked as a later phase; see §10).

---

## 2. Design principles (carried from the prototype)

1. **Task-based default path.** Jargon (relayd, WDS, proto handlers, kmod, subnets) stays out of the main flow. Flows pick sensible defaults automatically.
2. **Depth on demand.** Every screen has an **Advanced details** disclosure; every field has a `?` help tooltip. This is the bridge between the two audiences.
3. **Live, not hardcoded.** Devices, radios, protocols and clients are enumerated from the router at render time — never a static list. A plugged-in NIC or an installed protocol package shows up on its own.
4. **Offline-first.** System font stack only; all CSS/JS/icons shipped in the bundle; no CDN, no web fonts.
5. **Dual theme.** Light (consumer default) + dark (Merlin) via CSS custom-property tokens.

---

## 3. System architecture

```
Browser (SPA)  ──HTTPS──▶  uhttpd  ──▶  /ubus  (JSON-RPC over HTTP, via uhttpd-mod-ubus)
                                │                      │
                          static /www/untangled            ▼
                                                      ubusd  ◀── rpcd (session auth + ACLs,
                                                        │           + rpcd plugins: file, iwinfo, …)
                                      ┌─────────────────┼───────────────────┐
                                   netifd            UCI (/etc/config)    system/others
                                 (network.*)       (uci object via rpcd)   (board, log, apk…)
```

Layers we **keep as-is**: `ubusd` (message bus), `netifd` (network state), `UCI` (config store), `rpcd` (HTTP-exposed ubus with session login + ACLs), `uhttpd` (web server + `/ubus` endpoint).

Layer we **replace**: the UI. UnTangled is a static single-page app served from `/www/untangled/`, talking to `/ubus` only. No server-side rendering, no PHP/Lua pages.

**Why this shape:** it's the same contract LuCI's modern JS client uses, so it's proven on-device; it needs zero kernel/driver work; and the UI can be developed and tested against a real router's ubus with nothing else installed.

---

## 4. Frontend stack

**Recommendation: Svelte + Vite**, TypeScript, no UI component library (we own the design system from the prototype).

Rationale:
- **Bundle size** is the hard constraint on a router. Svelte compiles away the framework runtime; a full app realistically lands in the low hundreds of KB gzipped. (Preact is the fallback if we want a React-shaped API; avoid full React/Angular for size.)
- Vite gives a clean static build; output is hashed, gzipped (and optionally brotli) assets.
- No Tailwind/Bootstrap: ship the token-based CSS already designed in the prototype. No web-font step.

Hard rules for the build:
- Inline nothing from a CDN. All deps vendored into the bundle.
- Icons: the inline SVG symbol sprite from the prototype (no icon font).
- Target modern evergreen browsers; no legacy polyfills.
- Budget: aim ≤ 300 KB gzipped initial load; lazy-load heavier screens (e.g. charts) as separate chunks.

Deliverables: `/www/untangled/index.html` + hashed JS/CSS chunks, served by uhttpd.

---

## 5. Backend integration

### 5.1 Transport
All calls go to `POST /ubus` as JSON-RPC 2.0 (`call` method), the endpoint provided by **`uhttpd-mod-ubus`**. One thin client wraps it:

```ts
ubus.call("network.device", "status", {})          // list L2 devices
ubus.call("uci", "get", { config: "wireless" })     // read config
ubus.call("uci", "set", { config, section, values })// stage change
ubus.call("uci", "commit", { config })              // apply
```

### 5.2 Auth & session
- Login: `ubus call session login {username, password}` → returns a `ubus_rpc_session` token + granted ACLs. The SPA stores the token in memory (not localStorage) and sends it as the session id on every call.
- Session timeout + keep-alive (`session.access`/renew). Re-prompt on expiry.
- Serve over **HTTPS** (uhttpd with a `px5g` self-signed cert by default; allow user cert upload later). Token-based calls make CSRF a non-issue.
- Rate-limit failed logins (uhttpd/rpcd config).

### 5.3 ACLs
Ship a UnTangled ACL file in `/usr/share/rpcd/acl.d/untangled.json` granting exactly the ubus objects/methods the UI needs (read + the write scopes per feature). Define at least two roles for the enterprise requirement:
- **admin** — full read/write.
- **read-only** — status/read methods only (dashboards, logs).
(Multi-admin + audit is a later phase; the ACL split is the foundation.)

### 5.4 Data-source map (per screen)

| Screen | Primary ubus / source |
|---|---|
| Network Map | `system board`/`info`, `network.interface.wan status`, `network.device status`, clients via `luci-rpc getHostHints` + `getDHCPLeases`, `iwinfo assoclist` |
| Live tiles (CPU/mem/temp) | `system info`, `/proc` or `luci.statistics`/collectd, thermal via sysfs bridge |
| Wireless | `uci wireless`, radios/stations via `iwinfo` (`rpcd-mod-iwinfo`) |
| Guest Network | `uci wireless` + `uci firewall` (guest zone) + `uci dhcp` |
| Traffic Monitor | per-interface counters via `network.device status` polled, or nlbwmon/collectd for history |
| Parental Controls | `uci firewall` time-rules (nftables) + DNS filter (`uci dhcp`/adblock) |
| Extend Wi-Fi | `iwinfo scan`, then `uci wireless` (client iface) + `uci network` (relay via relayd) |
| Network Protection | adblock / banIP status+config via their rpcd/uci; dnsmasq rewrites |
| VPN | `uci network` WireGuard sections, keys via `wireguard-tools`, QR built client-side |
| Port Forwarding | `uci firewall` redirects (DNAT) |
| Internet (WAN) | `network.device status` + installed proto handlers (see §6); `uci network` |
| Administration | config snapshots + backup via `rpc-sys` (`sysupgrade -b`), change log |
| Software | package list / install / upgrade via **apk** (needs a small rpcd helper, see §7) |
| System Log | `log` ubus object (`logread`) |

### 5.5 Realtime
- `uhttpd-mod-ubus` is request/response; for live stats **poll** (1–2 s) the relevant status object.
- Hotplug (new NIC/radio): poll `network.device status` / `iwinfo devices` on the relevant screens, or add a tiny rpcd event-bridge later. The prototype's "appears automatically" behavior maps to this polling + diff.

---

## 6. Feature / protocol plugin contract

The prototype showed the rule: **physical devices auto-appear; protocol/interface *types* only appear when their handler package is installed.** We formalize this the way LuCI does with `luci-proto-*`.

A **UnTangled plugin** is an OpenWRT package that drops a descriptor the SPA discovers at runtime:

- Install location: `/www/untangled/plugins/*.json` (+ optional lazy JS chunk).
- Discovery: SPA fetches a generated manifest (directory listing via `rpcd-mod-file`, or a build-time concatenated `plugins/index.json`).
- A descriptor declares:

```jsonc
{
  "id": "wireguard",
  "kind": "protocol",            // protocol | interface-type | service
  "label": "WireGuard VPN",
  "appliesTo": ["ethernet","cellular","any"],
  "package": "luci-proto-wireguard",
  "fields": [                    // drives the generated form + ? help text
    { "name": "private_key", "type": "secret", "help": "…" },
    { "name": "peers", "type": "list", "schema": "wg-peer" }
  ],
  "uci": { "proto": "wireguard", "config": "network" },
  "component": "wireguard.js"    // optional custom UI, lazy-loaded
}
```

- The WAN wizard, the "Add interface" modal, and Network Protection all render from these descriptors. Installing `luci-proto-relay`+`relayd`, `luci-proto-qmi`, etc. makes those types appear with their own fields — no core UI change.
- Core ships descriptors for the built-ins (dhcp, static, pppoe) and simple generated forms; complex ones (WireGuard, relayd) ship a small component.

This keeps the core small and makes third-party extension first-class.

---

## 7. Package management, backup, firmware

- **apk (24.10):** no stable ubus method exists for apk the way opkg had tooling. Ship a small **rpcd helper** (`/usr/libexec/rpcd/untangled.sw`, ACL-gated) exposing `list`, `update`, `install`, `remove`, `upgrade` as ubus methods that shell out to `apk`. This isolates the privileged ops behind a defined, ACL-checked surface.
- **Backup/restore:** use `rpc-sys` (`rpcd-mod-rpcsys`) — `sysupgrade -b` creates the `.tar.gz`; a download route serves it; restore uploads + applies. Config *profiles* (named snapshots) are stored on-device under a UnTangled dir and are UCI snapshots.
- **Firmware update:** `rpc-sys` `upgrade_start`/`upgrade_test` (sysupgrade). Keep behind a clear confirmation + "keep settings" toggle.

---

## 8. Packaging & deployment

- Ship as an OpenWRT package **`untangled`** in a custom feed. Contents: static bundle → `/www/untangled/`, uhttpd config, ACL file, rpcd helper(s).
- Dependencies: `uhttpd`, `uhttpd-mod-ubus`, `rpcd`, `rpcd-mod-file`, `rpcd-mod-iwinfo`, `rpcd-mod-rpcsys`, plus feature packages as the user installs them.
- **Coexist with LuCI:** both read the same UCI, so installing UnTangled alongside LuCI is safe; serve UnTangled at `/` (or `/untangled/`) and leave LuCI at `/cgi-bin/luci`. Recommend keeping LuCI installed initially as a fallback/escape hatch.
- First-run: redirect to the setup wizard; set admin password before anything else.

---

## 9. Security

- HTTPS by default (px5g cert); offer user cert import.
- Token-based session from `session.login`; token in memory only; short idle timeout.
- Least-privilege ACLs per role; the apk/sysupgrade helpers are the only privileged surfaces and are ACL-gated and input-validated.
- No secrets in the hash/URL or localStorage. WireGuard private keys shown once (QR), never re-rendered from storage unless re-fetched.
- Login throttling; log admin actions (seeds the future audit log).

---

## 10. Roadmap

**Phase 0 — Foundations**
- Vite+Svelte scaffold, token-based ubus client, `session.login` + ACL file, HTTPS, offline bundle, design tokens/CSS ported from prototype, app shell + nav + command palette + help component.

**Phase 1 — Read-only dashboards (prove the data path)**
- Network Map (live), clients, Traffic Monitor, System Log. No writes — validates ubus/polling end-to-end on real hardware.

**Phase 2 — Core writes**
- Wireless, Guest, Internet/WAN wizard with live device enumeration + plugin-driven protocols, Administration (profiles/backup), Software (apk helper).

**Phase 3 — Consumer flows & protection**
- Parental Controls, Network Protection, Port Forwarding, Extend Wi-Fi (client + relayd), VPN (WireGuard + QR).

**Phase 4 — Remaining advanced**
- LAN, IPv6, Firewall, per-feature plugins; packaging/feed; first-run flow.

**Phase 5 — Enterprise+ (later)**
- Multi-admin roles + audit log; fleet/multi-device view.

---

## 11. Open decisions

1. **Framework:** Svelte (recommended) vs Preact — confirm before scaffolding.
2. **Serve path:** replace `/` or live at `/untangled/` beside LuCI for v1.
3. **History/stats source:** poll-only vs depend on collectd/nlbwmon for traffic history (adds size).
4. **apk surface:** custom rpcd helper (recommended) vs waiting for upstream apk-ubus tooling.
5. **Min hardware target:** sets the bundle/flash budget (e.g. 8/64 vs 16/128 vs 32/256 flash/RAM).
6. **Plugin discovery:** generated `plugins/index.json` at package-install time vs live `rpcd-mod-file` directory read.

---

*Companion: the interactive prototype (`ui-prototype/index.html`) is the visual/UX source of truth for every screen named above.*
