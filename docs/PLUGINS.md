# UnTangled Plugins

A LuCI-style modular system: installing a plugin **enriches the UI at runtime** —
new nav entries, screens, and command-palette actions — **without rebuilding the
core**. Plugins are plain ES modules, so they're independent of the core's
framework and survive core upgrades.

## How it works

1. On load, the app fetches **`plugins/index.json`** (served from the app root).
2. For each listed entry it dynamic-`import()`s the module and reads its default
   export — a plugin descriptor.
3. Each plugin is merged into the sidebar (under its group), the command palette,
   and the router: visiting `#<plugin-id>` renders the plugin.

On a device, the core app lives at `/www/untangled/`, so plugins live at
`/www/untangled/plugins/`. A plugin **package** drops its folder there and adds a
line to `index.json` (or ships its own and the core merges — see "Packaging").

## The manifest — `plugins/index.json`

```json
{
  "plugins": [
    { "id": "ping", "entry": "ping/ping.js" }
  ]
}
```

`entry` is resolved relative to `plugins/`. A bare string (`"ping/ping.js"`) also works.

## The plugin module

A self-contained ES module with a default export. **No bare imports** (no
`import ... from 'svelte'`) — everything it needs comes from the host API, so it
never couples to the core build.

```js
export default {
  id: 'ping',                 // unique; also the route (#ping)
  title: 'Ping Test',         // nav label + page title
  group: 'Tools',             // nav group (default: 'Plugins')
  icon: 'i-plugin',           // optional sprite id (default: puzzle icon)
  order: 10,                  // optional sort hint
  commands: [                 // optional command-palette entries
    { label: 'Run a ping test', run: () => { location.hash = 'ping'; } }
  ],
  // Render into `container`; return an optional cleanup function.
  mount(container, api) {
    container.innerHTML = `<div class="panel">…</div>`;
    const btn = container.querySelector('button');
    const onClick = async () => {
      const r = await api.ubus.call('file', 'exec', { command: 'ping', params: ['-c','3','openwrt.org'] });
      api.toast('done');
    };
    btn.addEventListener('click', onClick);
    return () => btn.removeEventListener('click', onClick);
  }
};
```

Reuse the core CSS classes (`panel`, `panel-b`, `btn`, `form-row`, `ctl`, `mono`,
`adv`, …) so the plugin looks native.

## The host API (`api`)

Passed to `mount(container, api)`. Stable contract, versioned by
`api.version` (currently `"1"`):

| Member | Use |
|---|---|
| `api.ubus.call(obj, method, params)` | Any ubus call (same client the core uses) |
| `api.ubus.uciGet/uciSet/uciAdd/uciDelete/uciApply` | Read/stage/apply UCI config |
| `api.toast(msg)` | Show a toast |
| `api.navigate(id)` | Go to a screen/plugin |
| `api.getTheme()` | `'light'` or `'dark'` (for plugin-drawn charts) |

ACLs still apply: a plugin can only call ubus methods the logged-in session is
granted. To use a new ubus object, the plugin package ships its own
`/usr/share/rpcd/acl.d/*.json`.

## Packaging a plugin for OpenWRT

A plugin is its own `.apk`/`.ipk` that:
- installs files to `/www/untangled/plugins/<id>/`,
- registers itself in `index.json` (a `uci-defaults` script merges its entry, or
  the core regenerates the manifest from the directory on boot),
- optionally ships an rpcd ACL for any extra ubus objects it needs,
- declares `DEPENDS:=+untangled`.

## Example

`public/plugins/ping/ping.js` ships with the repo as a working reference. It adds
a **Tools → Ping Test** screen that runs `ping` on the router via
`file.exec` — demonstrating nav + palette + ubus + core styling, with zero
changes to the core.
