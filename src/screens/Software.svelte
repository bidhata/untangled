<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { getFirmware, listPackages, pkgAction, type FwInfo, type SoftwareList } from '../lib/software';
  import { toast } from '../lib/toast';

  let fw: FwInfo | null = null;
  let list: SoftwareList = { available: false, packages: [] };
  let loading = true;
  let busy = false;
  let q = '';

  async function load() {
    loading = true;
    try { [fw, list] = await Promise.all([getFirmware().catch(() => null), listPackages()]); }
    finally { loading = false; }
  }
  onMount(load);

  $: filtered = list.packages.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));

  async function act(action: 'install' | 'remove' | 'update', name?: string) {
    busy = true;
    try { await pkgAction(action, name); toast(action + (name ? ' ' + name : '') + ' done'); await load(); }
    catch { toast('Action failed'); }
    finally { busy = false; }
  }
</script>

<div class="page-head"><div><div class="breadcrumb">System</div><h1>Software</h1><p>Firmware and packages — all on the router, no cloud account.</p></div></div>

{#if loading}
  <div class="panel"><div class="panel-b" style="color:var(--muted);text-align:center;padding:44px">Reading…</div></div>
{:else}
  <div class="panel" style="margin-bottom:18px"><div class="panel-b" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <div class="devicon" style="width:52px;height:52px"><Icon name="i-pkg" size={24} /></div>
    <div style="flex:1;min-width:200px">
      <div style="font-size:15px;font-weight:700">Firmware · {fw?.firmware ?? 'OpenWRT'}</div>
      <div class="hint mono">{fw?.target ?? ''} · {fw?.kernel ?? ''}</div>
    </div>
  </div></div>

  {#if !list.available}
    <div class="panel"><div class="panel-b">
      <div class="caution"><Icon name="i-pkg" size={20} /><span>{list.message}</span></div>
    </div></div>
  {:else}
    <div class="panel">
      <div class="panel-h"><h2>Packages</h2><span class="sub">apk</span></div>
      <div class="panel-b" style="padding-bottom:0"><input type="text" bind:value={q} placeholder="Search packages…" style="width:100%;margin-bottom:12px" /></div>
      <div style="overflow-x:auto"><table class="clients">
        <thead><tr><th>Package</th><th>Version</th><th style="text-align:right">Action</th></tr></thead>
        <tbody>
          {#each filtered as p}
            <tr style="cursor:default">
              <td><b style="font-weight:600">{p.name}</b></td>
              <td class="mono">{p.version}</td>
              <td style="text-align:right">
                {#if p.installed}<button class="btn" style="padding:6px 13px" on:click={() => act('remove', p.name)} disabled={busy}>Remove</button>
                {:else}<button class="btn primary" style="padding:6px 13px" on:click={() => act('install', p.name)} disabled={busy}>Install</button>{/if}
              </td>
            </tr>
          {/each}
          {#if !filtered.length}<tr><td colspan="3" style="color:var(--muted);padding:22px">No packages.</td></tr>{/if}
        </tbody>
      </table></div>
    </div>
  {/if}
{/if}
