<script lang="ts">
  import IconSprite from './components/IconSprite.svelte';
  import Shell from './components/Shell.svelte';
  import Login from './components/Login.svelte';
  import { session } from './lib/stores';
</script>

<IconSprite />

{#if $session.username}
  <Shell />
{:else}
  <Login />
{/if}
