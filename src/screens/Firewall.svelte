<script lang="ts">
  import { onMount } from 'svelte';
  import Help from '../components/Help.svelte';
  import { loadFirewall, saveZone, type FwZone, type FwForward, type Policy } from '../lib/firewall';
  import { toast } from '../lib/toast';
  import { startRollbackConfirm } from '../lib/confirm';

  let zones: FwZone[] = [];
  let originals: FwZone[] = [];
  let forwards: FwForward[] = [];
  let loading = true;
  let error = '';
  let busy = false;
  const POLICIES: Policy[] = ['ACCEPT', 'REJECT', 'DROP'];

  async function load() {
    loading = true;
    try {
      const r = await loadFirewall();
      zones = r.zones;
      forwards = r.forwards;
      originals = zones.map((z) => ({ ...z }));
      error = '';
    } catch {
      error = 'Could not read the firewall configuration.';
    } finally {
      loading = false;
    }
  }
  onMount(load);

  function dirty(i: number) {
    return originals[i] && JSON.stringify(zones[i]) !== JSON.stringify(originals[i]);
  }
  async function apply(i: number) {
    busy = true;
    try {
      await saveZone(zones[i]);
      const snap = { ...zones[i] };
      startRollbackConfirm('Firewall zone "' + zones[i].name + '"', {
        onKeep: () => { originals[i] = snap; originals = originals; },
        onRevert: load
      });
    } catch {
      toast('Could not apply changes');
    } finally {
      busy = false;
    }
  }
</script>

<div class="page-head">
  <div><div class="breadcrumb">Advanced Settings</div><h1>Firewall</h1><p>Control how traffic is allowed between your networks and the internet.</p></div>
</div>

{#if loading}
  <div class="panel"><div class="panel-b" style="color:var(--muted);text-align:center;padding:44px">Reading firewall configuration…</div></div>
{:else if error}
  <div class="panel"><div class="panel-b" style="text-align:center;padding:40px"><p style="color:var(--crit);margin:0 0 14px">{error}</p><button class="btn primary" on:click={load}>Retry</button></div></div>
{:else}
  {#each zones as z, i}
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-h"><h2><span class="chip">{z.name}</span></h2>
        <span class="sub">{z.networks.join(', ') || 'no networks'}</span>
      </div>
      <div class="panel-b">
        <div class="form-row">
          <div class="lbl">Incoming<Help text="Traffic from this zone to the router itself. REJECT is safe for wan; ACCEPT is usual for lan." /></div>
          <div class="ctl"><select bind:value={zones[i].input}>{#each POLICIES as p}<option value={p}>{p}</option>{/each}</select></div>
        </div>
        <div class="form-row">
          <div class="lbl">Outgoing<Help text="Traffic from the router out to this zone. Normally ACCEPT." /></div>
          <div class="ctl"><select bind:value={zones[i].output}>{#each POLICIES as p}<option value={p}>{p}</option>{/each}</select></div>
        </div>
        <div class="form-row">
          <div class="lbl">Forward<Help text="Traffic between devices within this zone. REJECT by default unless the zone needs internal routing." /></div>
          <div class="ctl"><select bind:value={zones[i].forward}>{#each POLICIES as p}<option value={p}>{p}</option>{/each}</select></div>
        </div>
        <div class="form-row">
          <div class="lbl">Masquerade (NAT)<Help text="Rewrites source addresses leaving this zone. On for wan so your LAN shares one public address; off for internal zones." /></div>
          <div class="ctl"><label class="toggle"><input type="checkbox" bind:checked={zones[i].masq} /><span class="track"></span><span class="knob"></span></label></div>
        </div>
        <div class="form-actions"><button class="btn primary" on:click={() => apply(i)} disabled={!dirty(i) || busy}>Apply</button></div>
      </div>
    </div>
  {/each}

  <div class="panel">
    <div class="panel-h"><h2>Zone forwarding</h2><span class="sub">who can reach whom</span></div>
    <div class="panel-b">
      {#if forwards.length}
        {#each forwards as f}<span class="chip">{f.src} → {f.dest}</span>{/each}
      {:else}<span class="hint">No forwarding rules.</span>{/if}
    </div>
  </div>
  <details class="adv" style="max-width:860px"><summary>Advanced details</summary><div class="advb">Zones and policies map to <span class="mono">config zone</span> / <span class="mono">forwarding</span> in <span class="mono">/etc/config/firewall</span>, compiled to nftables by fw4. Per-rule and port-forward editing live on their own screens.</div></details>
{/if}
