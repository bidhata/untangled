<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import {
    getBoard, getSysInfo, getWan, getClients, formatUptime,
    bandName, bandStroke, bandClass,
    type BoardInfo, type SysInfo, type WanStatus, type Client
  } from '../lib/net';

  let loading = true;
  let error = '';
  let board: BoardInfo | null = null;
  let sys: SysInfo | null = null;
  let wan: WanStatus | null = null;
  let clients: Client[] = [];
  let selected: string = 'router'; // 'router' | 'internet' | client id
  let timer: ReturnType<typeof setInterval> | undefined;

  async function loadAll() {
    try {
      const [b, s, w, c] = await Promise.all([getBoard(), getSysInfo(), getWan(), getClients()]);
      board = b; sys = s; wan = w; clients = c;
      error = '';
    } catch (e) {
      error = 'Could not read status from the router. Check the connection and try again.';
    } finally {
      loading = false;
    }
  }
  async function refreshLight() {
    try {
      const [s, w, c] = await Promise.all([getSysInfo(), getWan(), getClients()]);
      sys = s; wan = w; clients = c;
    } catch { /* keep last good values */ }
  }

  onMount(() => {
    loadAll();
    timer = setInterval(refreshLight, 5000);
  });
  onDestroy(() => clearInterval(timer));

  // ---- topology geometry ----
  const VW = 800, RX = 400, RY = 205, Y = 358, SPREAD = 720;
  $: shown = clients.slice(0, 12);
  function nodeX(i: number, n: number) {
    return n <= 1 ? RX : RX - SPREAD / 2 + (SPREAD / (n - 1)) * i;
  }
  function bars(sig: number) {
    return [1, 2, 3, 4].map((n) => n <= sig);
  }
  const selectedClient = () => clients.find((c) => c.id === selected) || null;
</script>

<div class="page-head">
  <div>
    <div class="breadcrumb">General</div>
    <h1>Network Map</h1>
    <p>Live view of your router, the internet connection, and every connected device.</p>
  </div>
</div>

{#if loading}
  <div class="panel"><div class="panel-b" style="text-align:center;color:var(--muted);padding:48px">Reading status from the router…</div></div>
{:else if error}
  <div class="panel"><div class="panel-b" style="text-align:center;padding:40px">
    <p style="color:var(--crit);margin:0 0 14px">{error}</p>
    <button class="btn primary" on:click={() => { loading = true; loadAll(); }}>Retry</button>
  </div></div>
{:else}
  <div class="tiles">
    <div class="tile">
      <div class="k"><Icon name="i-wan" size={15} /> Internet</div>
      <div class="v" style="font-size:16px;margin-top:11px;color:{wan?.up ? 'var(--good)' : 'var(--crit)'}">{wan?.up ? 'Connected' : 'Offline'}</div>
      <div class="hint mono" style="margin-top:4px">{wan?.ipv4 ?? '—'}</div>
    </div>
    <div class="tile">
      <div class="k"><Icon name="i-clients" size={15} /> Clients</div>
      <div class="v">{clients.length} <small>online</small></div>
    </div>
    <div class="tile">
      <div class="k"><Icon name="i-cpu" size={15} /> Load (1m)</div>
      <div class="v">{sys?.load1 ?? 0}</div>
    </div>
    <div class="tile">
      <div class="k"><Icon name="i-mem" size={15} /> Memory</div>
      <div class="v">{sys?.memUsedPct ?? 0}<small>%</small></div>
      <div class="meter"><i style="width:{sys?.memUsedPct ?? 0}%"></i></div>
    </div>
    <div class="tile">
      <div class="k"><Icon name="i-clock" size={15} /> Uptime</div>
      <div class="v" style="font-size:16px;margin-top:11px">{formatUptime(sys?.uptimeSec ?? 0)}</div>
    </div>
  </div>

  <div class="grid map-grid">
    <div class="panel">
      <div class="panel-h"><h2>Topology</h2><span class="sub">{wan?.device || 'wan'}</span></div>
      <div class="mapwrap">
        <svg class="topo" viewBox="0 0 {VW} 430" role="img" aria-label="Network topology">
          <!-- links -->
          <line class="link ilink" x1="400" y1="82" x2="400" y2="165" stroke-width="2.5" />
          {#each shown as c, i}
            <path class="link" d={`M400,245 C400,320 ${nodeX(i, shown.length)},285 ${nodeX(i, shown.length)},${Y - 30}`} stroke={bandStroke[c.band]} stroke-width="2.5" />
          {/each}
          <!-- internet -->
          <g class="node" class:sel={selected === 'internet'} role="button" tabindex="0"
             on:click={() => (selected = 'internet')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = 'internet'; } }}>
            <circle class="nbg" cx="400" cy="52" r="30" />
            <use class="inet-ic" href="#d-cloud" x="384" y="36" width="32" height="32" />
            <text x="400" y="100" text-anchor="middle" font-size="12">Internet</text>
          </g>
          <!-- router -->
          <g class="node" class:sel={selected === 'router'} role="button" tabindex="0"
             on:click={() => (selected = 'router')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = 'router'; } }}>
            <circle class="nbg-router" cx="400" cy="205" r="40" />
            <use class="router-ic" href="#d-router" x="378" y="183" width="44" height="44" />
            <text x="400" y="268" text-anchor="middle" font-size="12.5" font-weight="700">{board?.model ?? 'Router'}</text>
          </g>
          <!-- clients -->
          {#each shown as c, i}
            <g class="node" class:sel={selected === c.id} role="button" tabindex="0" aria-label={c.name}
               on:click={() => (selected = c.id)} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = c.id; } }}>
              <circle class="nbg" cx={nodeX(i, shown.length)} cy={Y} r="26" />
              <use href={'#' + c.kind} x={nodeX(i, shown.length) - 14} y={Y - 14} width="28" height="28" color={bandStroke[c.band]} />
              <text class="nlabel" x={nodeX(i, shown.length)} y={Y + 44} text-anchor="middle" font-size="11">{c.name.split(' ')[0]}</text>
            </g>
          {/each}
        </svg>
        <div class="legend">
          <span><i class="lg" style="background:var(--band5,#0fb5c4)"></i> 5 GHz</span>
          <span><i class="lg" style="background:#f79009"></i> 2.4 GHz</span>
          <span><i class="lg" style="background:#17b26a"></i> Wired</span>
          {#if clients.length > shown.length}<span style="opacity:.8">+{clients.length - shown.length} more below</span>{/if}
        </div>
      </div>
    </div>

    <div class="panel detail">
      <div class="panel-h"><h2>{selected === 'router' ? 'This Router' : selected === 'internet' ? 'Internet' : 'Device'}</h2></div>
      <div class="panel-b">
        {#if selected === 'router'}
          <div class="big"><div class="devicon"><Icon name="d-router" size={24} /></div><div><b>{board?.model}</b><div class="m">{board?.hostname}</div></div></div>
          <div class="kv"><span class="l">Firmware</span><span class="r">{board?.firmware}</span></div>
          <div class="kv"><span class="l">WAN IP</span><span class="r">{wan?.ipv4 ?? '—'}</span></div>
          <div class="kv"><span class="l">Gateway</span><span class="r">{wan?.gateway ?? '—'}</span></div>
          <div class="kv"><span class="l">Uptime</span><span class="r">{formatUptime(sys?.uptimeSec ?? 0)}</span></div>
          <div class="kv"><span class="l">Clients</span><span class="r">{clients.length} online</span></div>
        {:else if selected === 'internet'}
          <div class="big"><div class="devicon"><Icon name="d-cloud" size={24} /></div><div><b>WAN · {wan?.up ? 'Connected' : 'Offline'}</b><div class="m">{wan?.proto}</div></div></div>
          <div class="kv"><span class="l">Public IP</span><span class="r">{wan?.ipv4 ?? '—'}</span></div>
          <div class="kv"><span class="l">Gateway</span><span class="r">{wan?.gateway ?? '—'}</span></div>
          <div class="kv"><span class="l">DNS</span><span class="r">{wan?.dns?.join(' · ') || '—'}</span></div>
          <div class="kv"><span class="l">Uptime</span><span class="r">{formatUptime(wan?.uptimeSec ?? 0)}</span></div>
        {:else if selectedClient()}
          {@const c = selectedClient()}
          <div class="big"><div class="devicon"><Icon name={c!.kind} size={24} /></div><div><b>{c!.name}</b><div class="m mono">{c!.mac}</div></div></div>
          <div class="kv"><span class="l">Connection</span><span class="r"><span class="bandchip {bandClass[c!.band]}">{bandName[c!.band]}</span></span></div>
          <div class="kv"><span class="l">IP address</span><span class="r">{c!.ip}</span></div>
          <div class="kv"><span class="l">Signal</span><span class="r"><span class="sig">{#each bars(c!.signal) as on, bi}<i class:on style="height:{(bi + 1) * 3 + 2}px"></i>{/each}</span></span></div>
        {:else}
          <p class="hint">Select a device on the map.</p>
        {/if}
      </div>
    </div>
  </div>

  <div class="panel" style="margin-top:18px">
    <div class="panel-h"><h2>Connected Clients</h2><span class="sub">{clients.length} devices</span></div>
    <div style="overflow-x:auto">
      <table class="clients">
        <thead><tr><th>Device</th><th>IP Address</th><th>Connection</th><th>Signal</th></tr></thead>
        <tbody>
          {#each clients as c}
            <tr on:click={() => (selected = c.id)}>
              <td><div class="cname"><span class="mi"><Icon name={c.kind} size={17} /></span><span><b>{c.name}</b><small>{c.mac}</small></span></div></td>
              <td class="mono">{c.ip}</td>
              <td><span class="bandchip {bandClass[c.band]}">{bandName[c.band]}</span></td>
              <td><span class="sig">{#each bars(c.signal) as on, bi}<i class:on style="height:{(bi + 1) * 3 + 2}px"></i>{/each}</span></td>
            </tr>
          {/each}
          {#if !clients.length}
            <tr><td colspan="4" style="color:var(--muted);padding:22px">No clients seen yet.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
{/if}
