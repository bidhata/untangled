// Network data layer: fetch from ubus/luci-rpc and normalize into UI shapes.
// Field shapes follow OpenWRT 23.05 / 24.10; adjust if your build differs.
import { call } from './ubus';

export type DeviceKind =
  | 'd-phone' | 'd-laptop' | 'd-desktop' | 'd-tv' | 'd-game'
  | 'd-speaker' | 'd-tablet' | 'd-printer' | 'd-router' | 'd-cloud' | 'd-generic';
export type Band = '5' | '24' | 'wired' | '?';

export interface BoardInfo { model: string; hostname: string; firmware: string; }
export interface SysInfo { uptimeSec: number; load1: number; memUsedPct: number; }
export interface WanStatus {
  up: boolean; proto: string; device: string;
  ipv4: string | null; gateway: string | null; dns: string[]; uptimeSec: number;
}
export interface Client {
  id: string; name: string; mac: string; ip: string;
  kind: DeviceKind; band: Band; signal: number;
}

const num = (x: unknown): number => (typeof x === 'number' ? x : 0);

export async function getBoard(): Promise<BoardInfo> {
  const b = await call<any>('system', 'board');
  const rel = b?.release ?? {};
  const firmware =
    rel.description ||
    [rel.distribution, rel.version].filter(Boolean).join(' ') ||
    b?.kernel || 'OpenWRT';
  return { model: b?.model || b?.board_name || 'Router', hostname: b?.hostname || 'openwrt', firmware };
}

export async function getSysInfo(): Promise<SysInfo> {
  const s = await call<any>('system', 'info');
  const mem = s?.memory ?? {};
  const total = num(mem.total);
  const avail = num(mem.available ?? mem.free);
  const memUsedPct = total ? Math.round(((total - avail) / total) * 100) : 0;
  const load1 = Array.isArray(s?.load) ? +(num(s.load[0]) / 65536).toFixed(2) : 0;
  return { uptimeSec: num(s?.uptime), load1, memUsedPct };
}

export async function getWan(): Promise<WanStatus> {
  const dump = await call<any>('network.interface', 'dump');
  const list: any[] = dump?.interface ?? [];
  const w =
    list.find((i) => i.interface === 'wan') ||
    list.find((i) => Array.isArray(i.route) && i.route.some((r: any) => r.target === '0.0.0.0' || r.target === '::')) ||
    list.find((i) => i.interface !== 'loopback' && i.up);
  if (!w) return { up: false, proto: '?', device: '', ipv4: null, gateway: null, dns: [], uptimeSec: 0 };
  return {
    up: !!w.up,
    proto: w.proto || '?',
    device: w.l3_device || w.device || '',
    ipv4: w['ipv4-address']?.[0]?.address ?? null,
    gateway: (w.route ?? []).find((r: any) => r.target === '0.0.0.0')?.nexthop ?? null,
    dns: w['dns-server'] ?? [],
    uptimeSec: num(w.uptime)
  };
}

const NAME_RULES: [RegExp, DeviceKind][] = [
  [/iphone|galaxy|pixel|phone|oneplus|xiaomi|redmi/i, 'd-phone'],
  [/ipad|tablet|\btab\b/i, 'd-tablet'],
  [/macbook|laptop|thinkpad|notebook/i, 'd-laptop'],
  [/imac|desktop|workstation|\bpc\b/i, 'd-desktop'],
  [/\btv\b|roku|firetv|chromecast|appletv|bravia|shield/i, 'd-tv'],
  [/playstation|\bps[45]\b|xbox|nintendo|switch/i, 'd-game'],
  [/echo|alexa|homepod|sonos|speaker/i, 'd-speaker'],
  [/printer|epson|canon|brother/i, 'd-printer']
];
function guessKind(name: string): DeviceKind {
  for (const [re, k] of NAME_RULES) if (re.test(name)) return k;
  return 'd-generic';
}

function radioBand(radio: any): Band {
  const b = String(radio?.config?.band || radio?.config?.hwmode || '');
  if (/5|a/.test(b)) return '5';
  if (/2|g/.test(b)) return '24';
  return num(radio?.config?.channel) >= 36 ? '5' : '24';
}
function dbmToBars(dbm: number): number {
  if (dbm >= -55) return 4;
  if (dbm >= -66) return 3;
  if (dbm >= -77) return 2;
  return dbm ? 1 : 0;
}

async function getWirelessAssoc(): Promise<Record<string, { band: Band; signal: number }>> {
  const status = await call<any>('network.wireless', 'status');
  const map: Record<string, { band: Band; signal: number }> = {};
  for (const radio of Object.values<any>(status ?? {})) {
    const band = radioBand(radio);
    for (const iface of radio?.interfaces ?? []) {
      const ifname = iface?.ifname;
      if (!ifname) continue;
      try {
        const al = await call<any>('iwinfo', 'assoclist', { device: ifname });
        for (const r of al?.results ?? []) {
          if (r?.mac) map[String(r.mac).toUpperCase()] = { band, signal: dbmToBars(num(r.signal)) };
        }
      } catch {
        /* interface may be down */
      }
    }
  }
  return map;
}

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export async function getClients(): Promise<Client[]> {
  const [hints, leases, assoc] = await Promise.all([
    call<any>('luci-rpc', 'getHostHints').catch(() => ({})),
    call<any>('luci-rpc', 'getDHCPLeases').catch(() => ({ dhcp_leases: [] })),
    getWirelessAssoc().catch(() => ({} as Record<string, { band: Band; signal: number }>))
  ]);

  const byMac = new Map<string, Client>();
  const put = (mac: string, patch: Partial<Client>) => {
    if (!MAC_RE.test(mac)) return;
    const m = mac.toUpperCase();
    const cur =
      byMac.get(m) ??
      ({ id: m.replace(/:/g, ''), name: '', mac: m, ip: '', kind: 'd-generic', band: '?', signal: 0 } as Client);
    byMac.set(m, {
      ...cur,
      ...patch,
      name: patch.name || cur.name,
      ip: patch.ip || cur.ip
    });
  };

  for (const [mac, h] of Object.entries<any>(hints ?? {})) {
    put(mac, { name: h?.name || h?.host || '', ip: h?.ipv4 || h?.ipaddrs?.[0] || '' });
  }
  for (const l of leases?.dhcp_leases ?? []) {
    if (l?.macaddr) put(l.macaddr, { name: l.hostname && l.hostname !== '*' ? l.hostname : '', ip: l.ipaddr || '' });
  }

  const out: Client[] = [];
  for (const c of byMac.values()) {
    const a = assoc[c.mac];
    const name = c.name || c.ip || c.mac;
    out.push({ ...c, name, kind: guessKind(name), band: a ? a.band : 'wired', signal: a ? a.signal : 4 });
  }
  return out.filter((c) => c.ip).sort((a, b) => a.name.localeCompare(b.name));
}

export function formatUptime(sec: number): string {
  if (!sec) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
}

export const bandName: Record<Band, string> = { '5': '5 GHz', '24': '2.4 GHz', wired: 'Wired', '?': 'Unknown' };
export const bandStroke: Record<Band, string> = { '5': '#0fb5c4', '24': '#f79009', wired: '#17b26a', '?': '#7c8d97' };
export const bandClass: Record<Band, string> = { '5': 'b5', '24': 'b24', wired: 'bwired', '?': 'bunk' };

// ---- Traffic (per-device byte counters from network.device status) ---------
export interface DevStat {
  name: string; up: boolean;
  rxBytes: number; txBytes: number;
}
export async function getDevices(): Promise<DevStat[]> {
  const st = await call<any>('network.device', 'status');
  const out: DevStat[] = [];
  for (const [name, d] of Object.entries<any>(st ?? {})) {
    const s = d?.statistics ?? {};
    out.push({ name, up: !!d?.up, rxBytes: num(s.rx_bytes), txBytes: num(s.tx_bytes) });
  }
  return out;
}

export function formatBytes(b: number): string {
  if (b >= 1e12) return (b / 1e12).toFixed(2) + ' TB';
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}

// ---- System log (logd ubus) ------------------------------------------------
export interface LogEntry { time: number; priority: number; source: number; msg: string; }

export const LOG_LEVELS = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];

export async function getLog(lines = 200): Promise<LogEntry[]> {
  const r = await call<any>('log', 'read', { lines, stream: false });
  const arr = Array.isArray(r?.log) ? r.log : [];
  return arr.map((e: any) => ({
    time: num(e.time),
    priority: num(e.priority),
    source: num(e.source),
    msg: String(e.msg ?? '')
  }));
}

export function logLevelClass(p: number): string {
  return p <= 3 ? 'lv-err' : p === 4 ? 'lv-warn' : 'lv-info';
}

/** logd timestamps vary by build (us / ms / s); normalize to ms. */
export function logTimeMs(t: number): number {
  if (t > 1e14) return Math.floor(t / 1000);
  if (t > 1e11) return t;
  return t * 1000;
}
export function formatClock(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
