<script lang="ts">
  import Icon from './Icon.svelte';
  import { theme, toggleTheme, paletteOpen, session } from '../lib/stores';
  import { logout } from '../lib/ubus';

  export let onMenu: () => void = () => {};

  async function doLogout() {
    await logout();
    session.set({ username: null });
  }
</script>

<header class="topbar">
  <button class="hamburger" on:click={onMenu} aria-label="Open menu"><Icon name="i-menu" size={20} /></button>
  <div class="model">RT-AX88U <small>OpenWRT 24.10 · UnTangled 0.1</small></div>
  <div class="top-spacer"></div>
  <button class="tbtn" id="cmdBtn" on:click={() => paletteOpen.set(true)} aria-label="Search">
    <Icon name="i-search" /><span class="lbltxt">Search</span><kbd class="kbd">⌘K</kbd>
  </button>
  <span class="pill"><span class="dot"></span> Internet online</span>
  <button class="tbtn icbtn" on:click={toggleTheme} aria-label="Toggle theme">
    <Icon name={$theme === 'dark' ? 'i-sun' : 'i-moon'} />
  </button>
  <button class="tbtn" on:click={doLogout}><Icon name="i-logout" /> {$session.username}</button>
</header>
