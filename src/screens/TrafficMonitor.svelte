<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getDevices, getWan, formatBytes, type DevStat } from '../lib/net';

  const N = 60;
  type History = { down: number[]; up: number[]; peak: number }; // Mbps
  // Every interface keeps its own 60 s history, so switching the graph
  // to another interface shows its recent past right away.
  const history = new Map<string, History>();
  let down: number[] = Array(N).fill(0);
  let up: number[] = Array(N).fill(0);
  let curDown = 0, curUp = 0, peak = 0;
  let wanDev = '';
  let selected = ''; // interface shown in the graph; defaults to the WAN device
  let rows: { name: string; down: number; up: number; total: number }[] = [];
  let error = '';

  let prev = new Map<string, { rx: number; tx: number }>();
  let prevTs = 0;
  let canvas: HTMLCanvasElement;
  let timer: ReturnType<typeof setInterval> | undefined;

  function css(v: string) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }

  let sampling = false;
  async function sample() {
    // On a slow link a read can outlast the 1 s tick; overlapping samples would
    // compute rates from the wrong pair of counters and draw spikes.
    if (sampling) return;
    sampling = true;
    try {
      if (!wanDev) wanDev = (await getWan()).device || '';
      const devs = await getDevices();
      const now = performance.now();
      const dt = prevTs ? (now - prevTs) / 1000 : 0;

      const next = new Map<string, { rx: number; tx: number }>();
      const table: typeof rows = [];

      for (const d of devs) {
        next.set(d.name, { rx: d.rxBytes, tx: d.txBytes });
        const p = prev.get(d.name);
        let dMbps = 0, uMbps = 0;
        if (p && dt > 0) {
          dMbps = Math.max(0, ((d.rxBytes - p.rx) * 8) / dt / 1e6);
          uMbps = Math.max(0, ((d.txBytes - p.tx) * 8) / dt / 1e6);
        }
        table.push({ name: d.name, down: dMbps, up: uMbps, total: d.rxBytes + d.txBytes });

        const h = history.get(d.name) ?? { down: Array(N).fill(0), up: Array(N).fill(0), peak: 0 };
        h.down = [...h.down.slice(1), dMbps];
        h.up = [...h.up.slice(1), uMbps];
        h.peak = Math.max(h.peak, dMbps);
        history.set(d.name, h);
      }
      prev = next; prevTs = now;

      if (!selected) selected = wanDev;
      rows = table.filter((r) => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 10);
      error = '';
      showSelected();
    } catch {
      error = 'Could not read traffic counters from the router.';
    } finally {
      sampling = false;
    }
  }

  function showSelected() {
    const h = history.get(selected);
    if (h) {
      down = h.down;
      up = h.up;
      peak = h.peak;
      curDown = h.down[N - 1];
      curUp = h.up[N - 1];
    } else {
      down = Array(N).fill(0);
      up = Array(N).fill(0);
      peak = 0;
      curDown = 0;
      curUp = 0;
    }
    draw();
  }


  // Plain words for the internet connection, where the router's receive/send
  // IS the household's download/upload; neutral words for every other interface,
  // where it is not (a LAN port's "received" is a device uploading).
  $: isWan = !!selected && selected === wanDev;

  function select(name: string) {
    selected = name;
    showSelected();
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height, padL = 46, padB = 22, padT = 12, padR = 10;
    const gw = W - padL - padR, gh = H - padT - padB;
    ctx.clearRect(0, 0, W, H);
    const maxV = Math.max(10, Math.ceil(Math.max(...down, ...up) / 10) * 10);
    ctx.font = "12px ui-monospace,Menlo,Consolas,monospace";
    ctx.textBaseline = 'middle';
    const line = css('--line'), muted = css('--muted');
    for (let i = 0; i <= 4; i++) {
      const y = padT + gh * (i / 4);
      ctx.strokeStyle = line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(maxV * (1 - i / 4))), padL - 8, y);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = muted;
    ctx.fillText('Mbps · now', W - padR - 34, H - 8);
    ctx.fillText('-60s', padL + 14, H - 8);
    const X = (i: number) => padL + gw * (i / (N - 1));
    const Y = (v: number) => padT + gh * (1 - v / maxV);
    const series = (arr: number[], stroke: string, fill: string) => {
      ctx.beginPath(); ctx.moveTo(X(0), Y(arr[0]));
      for (let i = 1; i < N; i++) ctx.lineTo(X(i), Y(arr[i]));
      ctx.lineTo(X(N - 1), padT + gh); ctx.lineTo(X(0), padT + gh); ctx.closePath();
      const g = ctx.createLinearGradient(0, padT, 0, padT + gh);
      g.addColorStop(0, fill); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.moveTo(X(0), Y(arr[0]));
      for (let i = 1; i < N; i++) ctx.lineTo(X(i), Y(arr[i]));
      ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.beginPath(); ctx.arc(X(N - 1), Y(arr[N - 1]), 3.5, 0, 7); ctx.fillStyle = stroke; ctx.fill();
    };
    series(down, css('--accent') || '#0fb5c4', 'rgba(15,181,196,.26)');
    series(up, css('--good') || '#17b26a', 'rgba(23,178,106,.20)');
  }

  onMount(() => {
    sample();
    timer = setInterval(sample, 1000);
    const ro = () => draw();
    window.addEventListener('resize', ro);
    return () => window.removeEventListener('resize', ro);
  });
  onDestroy(() => clearInterval(timer));
</script>

<div class="page-head">
  <div>
    <div class="breadcrumb">General</div>
    <h1>Traffic Monitor</h1>
    <p>Live throughput per interface, read from the interface counters every second. Click an interface below to show it in the graph.</p>
  </div>
</div>

{#if error}
  <div class="panel"><div class="panel-b" style="color:var(--crit)">{error}</div></div>
{:else}
  <div class="traffic-big">
    <div class="tbox"><div class="k"><i style="background:var(--accent)"></i> {isWan ? 'Download' : 'Received'}</div><div class="v">{curDown.toFixed(1)}<small> Mbps</small></div></div>
    <div class="tbox"><div class="k"><i style="background:var(--good)"></i> {isWan ? 'Upload' : 'Sent'}</div><div class="v">{curUp.toFixed(1)}<small> Mbps</small></div></div>
    <div class="tbox"><div class="k">{isWan ? 'Peak download' : 'Peak received'}</div><div class="v">{peak.toFixed(1)}<small> Mbps</small></div></div>
    <div class="tbox"><div class="k">Interface</div><div class="v" style="font-size:18px">{selected || '—'}</div></div>
  </div>

  <div class="panel">
    <div class="panel-h"><h2>Throughput</h2><span class="sub">{selected || '—'} · last 60 s · Mbps</span></div>
    <div class="chartwrap"><canvas bind:this={canvas} width="1000" height="260"></canvas></div>
  </div>

  <div class="panel" style="margin-top:18px">
    <div class="panel-h"><h2>Interfaces</h2><span class="sub">totals since boot</span></div>
    <div style="overflow-x:auto">
      <table class="clients">
        <thead><tr><th>Interface</th><th>Received</th><th>Sent</th><th>Total transferred</th></tr></thead>
        <tbody>
          {#each rows as r}
            <!-- The whole row is clickable for the mouse; keyboard users reach the same action via the name button, whose click bubbles up here. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
            <tr class:sel={r.name === selected} on:click={() => select(r.name)}>
              <td class="mono"><button class="ifname" aria-pressed={r.name === selected}>{r.name}</button></td>
              <td class="mono">{r.down.toFixed(1)} Mbps</td>
              <td class="mono">{r.up.toFixed(1)} Mbps</td>
              <td class="mono">{formatBytes(r.total)}</td>
            </tr>
          {/each}
          {#if !rows.length}
            <tr><td colspan="4" style="color:var(--muted);padding:22px">Collecting counters…</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
  <p class="hint" style="margin-top:12px">Received and sent are counted from the router's side: what the router takes in on an interface, and what it puts out. On your internet connection that is download and upload. Per-client usage history needs an accounting package (nlbwmon or collectd); this view uses live interface counters, which every build has.</p>
{/if}

<style>
  .ifname { background: none; border: 0; padding: 0; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
</style>
