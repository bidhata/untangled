// Rollback-confirm flow for connectivity-risky config changes.
// A screen stages + applies with uciApplyRollback, then calls
// startRollbackConfirm(): the router will auto-revert unless the user (who can
// still reach the UI, proving the change didn't break their connection) keeps it.
import { writable } from 'svelte/store';
import { uciConfirm, uciRollback } from './ubus';

export interface ConfirmState { active: boolean; seconds: number; label: string; }
export const confirmState = writable<ConfirmState>({ active: false, seconds: 0, label: '' });

let timer: ReturnType<typeof setInterval> | undefined;
let onKeepCb: (() => void) | null = null;
let onRevertCb: (() => void) | null = null;

export function startRollbackConfirm(
  label: string,
  opts: { timeout?: number; onKeep?: () => void; onRevert?: () => void } = {}
) {
  const timeout = opts.timeout ?? 90;
  onKeepCb = opts.onKeep ?? null;
  onRevertCb = opts.onRevert ?? null;
  confirmState.set({ active: true, seconds: timeout, label });
  clearInterval(timer);
  timer = setInterval(() => {
    confirmState.update((s) => {
      if (!s.active) return s;
      const n = s.seconds - 1;
      if (n <= 0) { void doRevert(); return { active: false, seconds: 0, label: '' }; }
      return { ...s, seconds: n };
    });
  }, 1000);
}

function stop() {
  clearInterval(timer);
  confirmState.set({ active: false, seconds: 0, label: '' });
}

export async function keepChanges() {
  stop();
  try { await uciConfirm(); } catch { /* ignore */ }
  const cb = onKeepCb; onKeepCb = onRevertCb = null; cb?.();
}

export async function revertChanges() { await doRevert(); }

async function doRevert() {
  stop();
  try { await uciRollback(); } catch { /* ignore — router auto-reverts on its own timer */ }
  const cb = onRevertCb; onKeepCb = onRevertCb = null; cb?.();
}
