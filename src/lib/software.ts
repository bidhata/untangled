// Package + firmware info.
//
// Two ways to list packages:
//   1. The planned `untangled.sw` rpcd helper (richest: available + installed).
//   2. Fallback via file.exec running the on-device package manager
//      (`apk list --installed` on 24.10+, or `opkg list-installed` on 23.05).
// The fallback needs no extra package beyond file.exec (in the core ACL), so
// the Software screen shows what's actually installed even before the helper
// ships. "Notable apps" (tailscale, vnstat, …) are flagged so the UI can link
// to a dedicated screen for the ones we have a frontend for.
import { call } from './ubus';

export interface FwInfo { firmware: string; kernel: string; target: string; }
export interface Pkg { name: string; version: string; installed: boolean; notable?: NotableApp; }

export async function getFirmware(): Promise<FwInfo> {
  const b = await call<any>('system', 'board');
  const rel = b?.release ?? {};
  return {
    firmware: rel.description || [rel.distribution, rel.version].filter(Boolean).join(' ') || 'OpenWRT',
    kernel: b?.kernel ?? '',
    target: rel.target ?? ''
  };
}

export interface SoftwareList {
  available: boolean;          // can we install/remove from here?
  managed: boolean;            // did we get a real installed list at all?
  packages: Pkg[];
  message?: string;
}

// Apps we recognise and can point the user at. `screen` is a nav id that has a
// real frontend; `hint` explains what it does when there's no dedicated screen.
export interface NotableApp { id: string; label: string; screen?: string; hint: string; }
const NOTABLE: Record<string, NotableApp> = {
  tailscale: { id: 'tailscale', label: 'Tailscale VPN', screen: 'tailscale', hint: 'Mesh VPN — reach your network from anywhere.' },
  vnstat: { id: 'vnstat', label: 'vnStat', screen: 'usage', hint: 'Internet usage history (see Usage History).' },
  vnstat2: { id: 'vnstat', label: 'vnStat', screen: 'usage', hint: 'Internet usage history (see Usage History).' },
  nlbwmon: { id: 'nlbwmon', label: 'Per-device usage', screen: 'usage', hint: 'Per-device bandwidth accounting (see Usage History).' },
  'sqm-scripts': { id: 'sqm', label: 'Smart Queue (SQM)', screen: 'qos', hint: 'Bufferbloat control (see QoS).' },
  'ddns-scripts': { id: 'ddns', label: 'Dynamic DNS', screen: 'ddns', hint: 'Keep a hostname pointed at your IP (see Dynamic DNS).' },
  mwan3: { id: 'mwan3', label: 'Dual WAN', screen: 'dualwan', hint: 'Multi-WAN failover/balancing (see Dual WAN).' },
  'miniupnpd-nftables': { id: 'upnp', label: 'UPnP', screen: 'upnp', hint: 'Automatic port forwarding (see UPnP).' },
  miniupnpd: { id: 'upnp', label: 'UPnP', screen: 'upnp', hint: 'Automatic port forwarding (see UPnP).' },
  adblock: { id: 'adblock', label: 'Ad/threat blocking', screen: 'aiprotect', hint: 'DNS ad/threat blocking (see Network Protection).' },
  banip: { id: 'banip', label: 'IP blocking', screen: 'aiprotect', hint: 'Threat IP blocking (see Network Protection).' },
  ksmbd: { id: 'ksmbd', label: 'File sharing (SMB)', screen: 'usb', hint: 'Share USB storage over SMB (see USB Storage).' },
  'ksmbd-server': { id: 'ksmbd', label: 'File sharing (SMB)', screen: 'usb', hint: 'Share USB storage over SMB (see USB Storage).' },
  minidlna: { id: 'minidlna', label: 'Media server (DLNA)', screen: 'usb', hint: 'Stream media from USB (see USB Storage).' },
  wireguard: { id: 'wireguard', label: 'WireGuard VPN', screen: 'vpn', hint: 'WireGuard VPN (see VPN).' },
  'wireguard-tools': { id: 'wireguard', label: 'WireGuard VPN', screen: 'vpn', hint: 'WireGuard VPN (see VPN).' },
  'luci-proto-wireguard': { id: 'wireguard', label: 'WireGuard VPN', screen: 'vpn', hint: 'WireGuard VPN (see VPN).' }
};

function notableFor(name: string): NotableApp | undefined {
  if (NOTABLE[name]) return NOTABLE[name];
  // tailscale ships as `tailscale` + `tailscaled`; match the family loosely.
  if (/^tailscale/.test(name)) return NOTABLE.tailscale;
  return undefined;
}

async function exec(command: string, params: string[]): Promise<string | null> {
  try {
    const r = await call<any>('file', 'exec', { command, params });
    if (r && typeof r.code === 'number' && r.code !== 0) return null;
    const out = String(r?.stdout ?? '');
    return out.trim() ? out : null;
  } catch {
    return null;
  }
}

// `apk list --installed` -> lines like: "tailscale-1.80.3-r1 x86_64 {tailscale} ..."
function parseApk(out: string): Pkg[] {
  const pkgs: Pkg[] = [];
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^([a-z0-9][a-z0-9._+-]*?)-(\d[^ ]*)\s/i);
    if (!m) continue;
    pkgs.push({ name: m[1], version: m[2], installed: true, notable: notableFor(m[1]) });
  }
  return pkgs;
}

// `opkg list-installed` -> lines like: "tailscale - 1.80.3-1"
function parseOpkg(out: string): Pkg[] {
  const pkgs: Pkg[] = [];
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\S+)\s+-\s+(\S+)/);
    if (!m) continue;
    pkgs.push({ name: m[1], version: m[2], installed: true, notable: notableFor(m[1]) });
  }
  return pkgs;
}

async function listViaExec(): Promise<Pkg[] | null> {
  // Prefer apk (24.10+); fall back to opkg (23.05 and earlier).
  const apk = await exec('apk', ['list', '--installed']);
  if (apk) {
    const pkgs = parseApk(apk);
    if (pkgs.length) return pkgs;
  }
  const opkg = await exec('opkg', ['list-installed']);
  if (opkg) {
    const pkgs = parseOpkg(opkg);
    if (pkgs.length) return pkgs;
  }
  return null;
}

export async function listPackages(): Promise<SoftwareList> {
  // 1. Rich helper, if present.
  try {
    const r = await call<any>('untangled.sw', 'list', {});
    const pkgs: Pkg[] = (r?.packages ?? []).map((p: any) => ({
      name: String(p.name ?? ''),
      version: String(p.version ?? ''),
      installed: !!p.installed,
      notable: notableFor(String(p.name ?? ''))
    }));
    if (pkgs.length) return { available: true, managed: true, packages: pkgs };
  } catch {
    /* helper not installed — fall through to file.exec */
  }

  // 2. Fallback: list installed packages with the on-device package manager.
  const installed = await listViaExec();
  if (installed) {
    installed.sort((a, b) => {
      if (!!a.notable !== !!b.notable) return a.notable ? -1 : 1; // notable apps first
      return a.name.localeCompare(b.name);
    });
    return {
      available: false,
      managed: true,
      packages: installed,
      message:
        'Showing packages installed on this router. To install or remove packages from here, add the `untangled` package helper.'
    };
  }

  // 3. Nothing worked.
  return {
    available: false,
    managed: false,
    packages: [],
    message:
      'Could not read the package list. Install the `untangled-full` package (it adds file access) to view and manage software here.'
  };
}

export async function pkgAction(action: 'install' | 'remove' | 'update', name?: string): Promise<void> {
  await call('untangled.sw', action, name ? { name } : {});
}
