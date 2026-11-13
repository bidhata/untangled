<script lang="ts">
  import { onMount } from 'svelte';
  import { runChecks, overall, type Finding, type Severity } from '../lib/doctor';
  import { go } from '../lib/stores';

  let findings: Finding[] = [];
  let busy = true;

  async function run() {
    busy = true;
    try {
      findings = await runChecks();
    } finally {
      busy = false;
    }
  }
  onMount(run);

  $: status = overall(findings);
  const dot: Record<Severity, string> = { ok: 'var(--good)', warn: 'var(--warn, #f79009)', crit: 'var(--crit)' };
  const headline: Record<Severity, string> = {
    ok: 'Everything looks healthy.',
    warn: 'A few things worth a look.',
    crit: 'Something needs attention.'
  };
</script>

<div class="page-head">
  <div>
    <div class="breadcrumb">System</div>
    <h1>Network Doctor</h1>
    <p>A quick, read-only health check of your router. Nothing is changed.</p>
  </div>
  <button class="btn" on:click={run} disabled={busy}>{busy ? 'Checking…' : 'Re-run'}</button>
</div>

<div class="panel">
  <div class="panel-h">
    <h2><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:{dot[status]};margin-right:8px"></i>{busy ? 'Checking…' : headline[status]}</h2>
    <span class="sub">{findings.length} checks</span>
  </div>
  <div class="panel-b">
    <table class="clients">
      <tbody>
        {#each findings as f (f.id)}
          <tr style="cursor:default">
            <td style="width:14px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:{dot[f.severity]}"></i></td>
            <td>
              <b style="font-weight:600">{f.title}</b>
              {#if f.detail}<div class="mono" style="color:var(--muted);white-space:pre-wrap;margin-top:4px">{f.detail}</div>{/if}
            </td>
            <td style="text-align:right">
              {#if f.screen && f.severity !== 'ok'}
                <button class="btn" on:click={() => go(f.screen!)}>Open</button>
              {/if}
            </td>
          </tr>
        {/each}
        {#if !findings.length && busy}
          <tr><td colspan="3" style="color:var(--muted);padding:22px">Running checks…</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
