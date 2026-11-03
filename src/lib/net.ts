// Network data layer: fetch from ubus/luci-rpc and normalize into UI shapes.
// Field shapes follow OpenWRT 23.05 / 24.10; adjust if your build differs.
import { call } from './ubus';

export type DeviceKind =
  | 'd-phone' | 'd-laptop' | 'd-desktop' | 'd-tv' | 'd-game'
  | 'd-speaker' | 'd-tablet' | 'd-printer' | 'd-router' | 'd-cloud' | 'd-generic';
export type Band = '5' | '24' | '6' | 'wired' | '?';

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

// Resolve a radio's band from the `network.wireless status` object. OpenWRT
// reports it as `config.band` = "2g"/"5g"/"6g" on 21.02+, older builds use
// `config.hwmode` (11a/11g/…), and as a last resort we infer from the channel.
function radioBand(radio: any): Band {
  const cfg = radio?.config ?? {};
  const b = String(cfg.band ?? '').toLowerCase();
  if (b.includes('6')) return '6';
  if (b.includes('5')) return '5';
  if (b.includes('2')) return '24';
  const hw = String(cfg.hwmode ?? '').toLowerCase();
  if (hw.includes('a')) return '5'; // 11a/11ac/11ax-5
  if (hw.includes('g') || hw.includes('b')) return '24';
  const ch = num(cfg.channel);
  if (ch >= 36) return '5';
  if (ch > 0) return '24';
  return '?';
}
function dbmToBars(dbm: number): number {
  if (dbm >= -55) return 4;
  if (dbm >= -66) return 3;
  if (dbm >= -77) return 2;
  return dbm ? 1 : 0;
}

// Returns a map of client MAC -> {band, signal}, plus whether the wireless
// subsystem actually answered. `ok=false` means we could not read any radio,
// so callers must NOT assume unlisted devices are wired.
async function getWirelessAssoc(): Promise<{
  map: Record<string, { band: Band; signal: number }>;
  ok: boolean;
}> {
  const map: Record<string, { band: Band; signal: number }> = {};
  let status: any;
  try {
    status = await call<any>('network.wireless', 'status');
  } catch {
    return { map, ok: false };
  }
  const radios = Object.values<any>(status ?? {});
  if (!radios.length) return { map, ok: false };

  let sawIface = false;
  const lookups: Promise<void>[] = [];
  for (const radio of radios) {
    const band = radioBand(radio);
    for (const iface of radio?.interfaces ?? []) {
      // ifname sits directly on the interface or under its config, by build.
      const ifname = iface?.ifname || iface?.config?.ifname || iface?.iface;
      if (!ifname) continue;
      sawIface = true;
      lookups.push(
        call<any>('iwinfo', 'assoclist', { device: ifname })
          .then((al) => {
            for (const r of al?.results ?? []) {
              if (r?.mac) map[String(r.mac).toUpperCase()] = { band, signal: dbmToBars(num(r.signal)) };
            }
          })
          .catch(() => {
            /* interface may be down or iwinfo missing */
          })
      );
    }
  }
  await Promise.all(lookups);
  // If radios exist but none exposed an interface we could query, we still
  // can't tell wired from wireless — report not-ok so devices show Unknown
  // rather than being mislabeled "Wired".
  return { map, ok: sawIface };
}

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export async function getClients(): Promise<Client[]> {
  const [hints, leases, wifi] = await Promise.all([
    call<any>('luci-rpc', 'getHostHints').catch(() => ({})),
    call<any>('luci-rpc', 'getDHCPLeases').catch(() => ({ dhcp_leases: [] })),
    getWirelessAssoc().catch(
      () => ({ map: {} as Record<string, { band: Band; signal: number }>, ok: false })
    )
  ]);
  const assoc = wifi.map;
  const wifiOk = wifi.ok;

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
    // A device is wireless if it's in an assoclist. Otherwise it's wired —
    // but only claim "wired" when the wireless subsystem actually answered;
    // if it didn't, we genuinely don't know, so report Unknown.
    const band: Band = a ? a.band : wifiOk ? 'wired' : '?';
    const signal = a ? a.signal : band === 'wired' ? 4 : 0;
    out.push({ ...c, name, kind: guessKind(name), band, signal });
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

export const bandName: Record<Band, string> = { '5': '5 GHz', '24': '2.4 GHz', '6': '6 GHz', wired: 'Wired', '?': 'Unknown' };
export const bandStroke: Record<Band, string> = { '5': '#0fb5c4', '24': '#f79009', '6': '#7a5af8', wired: '#17b26a', '?': '#7c8d97' };
export const bandClass: Record<Band, string> = { '5': 'b5', '24': 'b24', '6': 'b6', wired: 'bwired', '?': 'bunk' };

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
