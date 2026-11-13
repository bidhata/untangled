// USB apps: share attached storage over the network (SMB via ksmbd) and stream
// media (DLNA via minidlna). Each degrades to "not installed" when its package
// is absent. Attached storage is read from /proc/mounts.
import { call, uciGet, uciSet, uciAdd, uciDelete, uciApply } from './ubus';

export interface UsbMount { device: string; mountpoint: string; fstype: string; }

export interface ShareSvc {
  installed: boolean;
  enabled: boolean;
  path: string;
  id: string | null;   // managed section id
  server?: SmbServer;  // which SMB server owns the share (SMB only)
}

// The two OpenWRT SMB servers differ only in names: uci config, share section
// type and init script.
export type SmbServer = 'ksmbd' | 'samba4';
const SMB: Record<SmbServer, { config: string; type: string; init: string }> = {
  ksmbd: { config: 'ksmbd', type: 'share', init: '/etc/init.d/ksmbd' },
  samba4: { config: 'samba4', type: 'sambashare', init: '/etc/init.d/samba4' }
};

export interface UsbState {
  mounts: UsbMount[];
  smb: ShareSvc;
  dlna: ShareSvc;
}

const text = (v: unknown): string => (v == null ? '' : String(Array.isArray(v) ? v[0] : v));
const first = (v: unknown): string => (Array.isArray(v) ? text(v[0]) : text(v));
const SHARE_NAME = 'UnTangled';
const SYSTEM_MOUNT = /^\/($|rom|overlay|boot|etc|tmp|proc|sys|dev|lib|usr|www|root|var)(\/|$)/;

/** A folder is shareable only when it sits on attached storage, never on the router's own filesystem. */
export function shareablePath(path: string, mounts: UsbMount[]): boolean {
  const p = path.trim().replace(/\/+$/, '');
  if (!p.startsWith('/') || p.includes('..')) return false;
  return mounts.some((m) => p === m.mountpoint || p.startsWith(m.mountpoint + '/'));
}

async function readMounts(): Promise<UsbMount[]> {
  let data = '';
  try { const r = await call<any>('file', 'read', { path: '/proc/mounts' }); data = text(r?.data); } catch { /* */ }
  const out: UsbMount[] = [];
  for (const line of data.split('\n')) {
    const [dev, mnt, fs] = line.split(/\s+/);
    if (!dev || !mnt) continue;
    // Only real add-on storage. The router's own partitions also live on
    // sd*/mmcblk*/ubi* devices (/, /rom, /overlay, /boot, bind mounts in /etc);
    // listing them made "/overlay" the default share folder on NAND routers.
    if (SYSTEM_MOUNT.test(mnt)) continue;
    if (/^\/dev\/(sd|mmcblk|nvme)/.test(dev) || /^\/(mnt|media)\//.test(mnt)) {
      out.push({ device: dev, mountpoint: mnt, fstype: fs || '' });
    }
  }
  return out;
}

async function loadSmbFrom(server: SmbServer): Promise<ShareSvc | null> {
  try {
    const r = await uciGet(SMB[server].config);
    const v = (r as any)?.values ?? r ?? {};
    let id: string | null = null, path = '', enabled = false;
    for (const [sid, s] of Object.entries<any>(v)) {
      if (s?.['.type'] !== SMB[server].type) continue;
      if (text(s.name) === SHARE_NAME) { id = sid; path = text(s.path); enabled = true; break; }
      if (!id) { id = sid; path = text(s.path); enabled = true; }
    }
    return { installed: true, enabled, path, id, server };
  } catch {
    return null;
  }
}

async function loadSmb(): Promise<ShareSvc> {
  return (await loadSmbFrom('ksmbd'))
    ?? (await loadSmbFrom('samba4'))
    ?? { installed: false, enabled: false, path: '', id: null };
}

async function loadDlna(): Promise<ShareSvc> {
  try {
    const r = await uciGet('minidlna');
    const v = (r as any)?.values ?? r ?? {};
    for (const [sid, s] of Object.entries<any>(v)) {
      if (s?.['.type'] !== 'minidlna') continue;
      return { installed: true, enabled: text(s.enabled) === '1', path: first(s.media_dir), id: sid };
    }
    return { installed: true, enabled: false, path: '', id: 'config' };
  } catch {
    return { installed: false, enabled: false, path: '', id: null };
  }
}

export async function loadUsb(): Promise<UsbState> {
  const [mounts, smb, dlna] = await Promise.all([readMounts(), loadSmb(), loadDlna()]);
  return { mounts, smb, dlna };
}

export async function setSmb(on: boolean, path: string, id: string | null, server: SmbServer = 'ksmbd'): Promise<void> {
  const { config, type, init } = SMB[server];
  if (on) {
    const values = { name: SHARE_NAME, path, read_only: 'no', guest_ok: 'yes', browseable: 'yes', create_mask: '0666', dir_mask: '0777' };
    if (id) await uciSet(config, id, values);
    else await uciAdd(config, type, undefined, values);
  } else if (id) {
    await uciDelete(config, id);
  }
  await uciApply();
  await call('file', 'exec', { command: init, params: [on ? 'restart' : 'reload'] }).catch(() => {});
  if (on) await call('file', 'exec', { command: init, params: ['enable'] }).catch(() => {});
}

export async function setDlna(on: boolean, path: string, id: string | null): Promise<void> {
  const sid = id ?? 'config';
  const values: Record<string, unknown> = { enabled: on ? '1' : '0' };
  if (on && path) values.media_dir = [path];
  if (id) await uciSet('minidlna', sid, values);
  else await uciAdd('minidlna', 'minidlna', 'config', { enabled: on ? '1' : '0', media_dir: on && path ? [path] : [], friendly_name: 'UnTangled' });
  await uciApply();
  await call('file', 'exec', { command: '/etc/init.d/minidlna', params: [on ? 'restart' : 'stop'] }).catch(() => {});
  if (on) await call('file', 'exec', { command: '/etc/init.d/minidlna', params: ['enable'] }).catch(() => {});
}
