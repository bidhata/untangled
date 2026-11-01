<script lang="ts">
  import Icon from './Icon.svelte';
  import { login, UbusError } from '../lib/ubus';
  import { session } from '../lib/stores';

  let username = 'root';
  let password = '';
  let error = '';
  let busy = false;

  async function submit(e: Event) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      const r = await login(username, password);
      session.set({ username: r.data?.username ?? username });
    } catch (err) {
      if (err instanceof UbusError && err.code === 6) error = 'Wrong username or password.';
      else error = 'Could not reach the router. Check the connection and try again.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="login-wrap">
  <form class="login-card" on:submit={submit}>
    <div class="logo"><Icon name="i-wifi" size={22} /></div>
    <h1>Sign in to UnTangled</h1>
    <p>Enter your router's admin credentials.</p>

    {#if error}<div class="login-err">{error}</div>{/if}

    <label for="u">Username</label>
    <input id="u" type="text" bind:value={username} autocomplete="username" />

    <label for="p">Password</label>
    <input id="p" type="password" bind:value={password} autocomplete="current-password" />

    <button class="btn primary" type="submit" disabled={busy}>
      {busy ? 'Signing in…' : 'Sign in'}
    </button>
  </form>
</div>
