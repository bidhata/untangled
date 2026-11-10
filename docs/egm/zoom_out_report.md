# Goldfish Review Report — Stage 5: Initial Zoom Out

**Target:** `docs/ARCHITECTURE.md` (lines 1-217, full file)
**Standard:** zoom-out-standard
**Date:** 2026-11-10

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `zoom_out` (Skeptical Architect) | completed |
| `inventive_catalyst` | completed |

## Context Sufficiency

Passes. Both reviewers could state the objective (a static SPA over uhttpd-mod-ubus that reuses UCI/ubus/rpcd/uhttpd unchanged, offline, coexisting with LuCI). §1 goals/non-goals, §2 principles, §3 diagram and §5.1 transport are at the right altitude and match the code; keep them.

Shared observation: the document is the pre-build plan from the first commit (1 Nov) while the repo is at v0.1.13 with 38 commits. Most findings below are the plan diverging from what was built, which is simpler.

## Prioritized Findings

### Plugin contract in the doc is not the one that shipped - Severity: Major
* **Reviewer Lens:** `zoom_out`, `inventive_catalyst`
* **Affected Scope:** §6 (lines 124-153), §11 item 6 (line 213)
* **Discrepancy Description:** §6 specifies a declarative JSON descriptor schema (`kind`, `appliesTo`, typed `fields`, `uci` binding, lazy `component`) driving generated forms. The code (`src/lib/plugins.ts`, `src/lib/pluginApi.ts`, `docs/PLUGINS.md`) implements an imperative ES-module `mount(container, api)` contract loaded from a build-time `plugins/index.json`; WAN protocols are a fixed dhcp/static/pppoe switch in `src/lib/wan.ts`; "appears when installed" is delivered by per-screen detection that degrades to an install card. The descriptor design is a second plugin system plus a form generator plus a schema language for packages nobody has written (YAGNI), and the JSON block is an altitude drop.
* **Rationale & Recommendation:** Replace §6 with the as-built contract or a pointer to `docs/PLUGINS.md`; delete open decision 6 (decided). Inventive-catalyst alternative worth recording, not adopting now: per-plugin directory discovery via `file list` would remove the shared mutable `index.json` that every plugin package must edit; cost is one ACL read grant and discovery only after login.

### `untangled.sw` apk helper is documented and ACL-granted but does not exist - Severity: Major
* **Reviewer Lens:** `zoom_out`, `inventive_catalyst`
* **Affected Scope:** §7 line 159, §5.4 line 115, §9 line 178, §11 item 4 (line 211); ACL `untangled.sw` grants; `src/lib/software.ts` fallback text
* **Discrepancy Description:** The only rpcd helper shipped is `untangled.mesh`. `software.ts` lists packages via path-scoped `file.exec` of `apk list` / `opkg list-installed`, consistent with how vnstat, nlbw, tailscale and etherwake are reached. The doc's premise "apk (24.10)" is wrong (24.10 is opkg; apk is snapshot-only). The ACL grants five methods on a phantom object and the UI tells users to install a helper that cannot be installed.
* **Rationale & Recommendation:** Decide and write down one of: (A) a single script rpcd plugin owning the command allowlist (then §9's "helpers are the only privileged surface" becomes true, at the cost of two forks per call and moving validation into shell), or (B) declare path-scoped `file.exec` as the pattern, drop the helper from §7/§9/§11, remove the `untangled.sw` ACL grants and the dead UI message. Reviewers lean (B): it is what shipped and is reviewable in the ACL diff.

### Document presents closed decisions as open and history as roadmap - Severity: Major
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** lines 5-6, §4 (58-69), §10 (184-202), §11 (206-213)
* **Discrepancy Description:** Framework, serve path, stats source, apk surface, plugin discovery are all decided in code (Svelte 5; `/untangled/` with `base: './'`; poll-only plus optional vnstat/nlbwmon; file.exec; build-time index.json; opkg on stable). Phases 0-4 are shipped. Target platform, package manager, and bundle budget (300 KB vs ~75 KB actual) contradict README.md, the root document the standard says designs must align with.
* **Rationale & Recommendation:** Collapse §4/§11 into "decisions taken"; replace §10 with README's "Next up" or delete it.

### The one non-trivial architecture (apply / rollback / confirm) is absent - Severity: Major
* **Reviewer Lens:** `zoom_out`, `inventive_catalyst`
* **Affected Scope:** §5.1 (78-85), §3, §8 line 169, §9
* **Discrepancy Description:** The doc's write path is `uci set` then `uci commit`, and lock-out safety is "keep LuCI as an escape hatch". The shipped app applies connectivity-risky changes with `uci apply {rollback:true, timeout}` and a UI countdown that must stay shorter than the router timer, then `uci confirm` or `uci rollback` (`src/lib/ubus.ts`, `src/lib/confirm.ts`); the ACL already grants apply/confirm/rollback. Also missing: the `untangled.mesh` helper and package, the detect-and-degrade pattern, and the dev mock backend (`MOCK_ENABLED`, `ROUTER` proxy).
* **Rationale & Recommendation:** Add a short apply-rollback-confirm data-flow paragraph at §3 altitude, stating which configs use it and which use plain apply. Record the liabilities the catalyst named: tab closed during the window reverts a good change; init-script reloads via `file.exec` sit outside the rollback contract, so a rollback restores UCI but not necessarily running service state.

### Dependency boundary disagrees across doc, README and Makefile - Severity: Major
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §8 (165-170), §5.3 (93-97), §9 line 176
* **Discrepancy Description:** Doc lists `rpcd-mod-iwinfo` and `rpcd-mod-rpcsys` as core and omits `rpcd-mod-luci` although §5.4 routes Network Map through `luci-rpc`. Makefile puts all three in `untangled-full`; README calls rpcd-mod-luci a core requirement; ACL grants luci-rpc to both roles. Doc says HTTPS by default; shipped split is HTTP-only core plus HTTPS in -full (SECURITY.md is accurate).
* **Rationale & Recommendation:** State the core-plus-meta-package shape once, and which ubus objects core may assume versus detect. That resolves the README/Makefile disagreement instead of adding a fourth opinion.

### Independent per-call polling accepted as a transport law - Severity: Nit
* **Reviewer Lens:** `inventive_catalyst`
* **Affected Scope:** §5.5 (118-120), §5.1
* **Discrepancy Description:** Each tile polls independently; each `call()` is its own POST and uhttpd fork. uhttpd-mod-ubus accepts JSON-RPC batch arrays (LuCI's client uses them).
* **Rationale & Recommendation:** Advisory. A same-tick batcher that backs off when `document.hidden` would cut router load; liabilities are per-item error semantics and head-of-line blocking (never batch `iwinfo scan`). The zoom-out reviewer explicitly found no premature-optimisation problem with current 1-5 s polling at this scale, so this is a future option, not a defect.

### Token-in-memory-only presented as a security control - Severity: Nit
* **Reviewer Lens:** `inventive_catalyst`
* **Affected Scope:** §5.2 line 88, §9 line 177
* **Discrepancy Description:** Same-origin XSS reads a JS variable as easily as storage; the real controls are rpcd's idle timeout and a no-inline-script CSP. The cost is a fresh login on every reload for non-technical users.
* **Rationale & Recommendation:** Document the actual threat model; consider sessionStorage. Note some browsers persist sessionStorage for tab restore.

### Speculative features written as architecture - Severity: Nit
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §5.2 lines 89-91, §5.5 line 120, §7 line 160, §8 line 170, §9 line 180, §10 Phase 5
* **Discrepancy Description:** session keep-alive/renew (no `session.access` call in src), login rate limiting, rpcd event bridge, named config profiles, first-run wizard, admin action log, fleet view: none built after 38 commits.
* **Rationale & Recommendation:** Move to a roadmap or delete.

### Read-only role is shipped but unused and unmentioned - Severity: Nit
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §5.3 (94-97); ACL `untangled-readonly`
* **Discrepancy Description:** No login maps to it, the UI has no role concept, README does not mention it, and it must be hand-synchronised with the admin list.
* **Rationale & Recommendation:** Say it is an extra for people who edit `/etc/config/rpcd` by hand, or drop the "enterprise requirement" framing.

### Data-source table is stale - Severity: Nit
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §5.4 (99-116)
* **Discrepancy Description:** Rows cite collectd/thermal sysfs, config snapshots, apk helper, adblock DNS filter that were never used; screens in `src/lib/nav.ts` are missing (Devices, Usage History, DDNS, QoS, Dual WAN, UPnP, Tailscale, DMZ, USB, Firmware, Mesh).
* **Rationale & Recommendation:** Refresh from `src/lib/*.ts`, one module per row.

## What passes

§1, §2, §3, §5.1, §7 bullets 2-3 (backup and firmware path matches `firmware.ts`), the offline/no-CDN rule, LuCI coexistence. No premature optimisation; no reinvented wheels at the architecture level.

## Smallest fix proposed by reviewers

Keep §1-§3 and §5.1; rewrite §4/§6/§7/§8/§11 as decisions taken against the code; add one apply-rollback-confirm paragraph; replace §10 with README's "Next up".
