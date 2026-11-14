// Extend Wi-Fi: scan for upstream networks and join one as a client ("routed
// client"): the router connects to that Wi-Fi on a `wwan` network (DHCP) and
// shares it with everything behind it through NAT, exactly like a wired WAN.
import { call, uciGet, uciSet, uciAdd, firewallApply } from './ubus';
import { loadWireless, keyProblem } from './wireless';
import { wirelessStatus } from './net';
import { stageWanZone } from './firewall';

export interface ScanResult {
  ssid: string;
  signal: number;
  locked: boolean;
  bssid: string;
  radio: string;       // wifi-device that heard it (the one that must join it)
  bandLabel: string;
  encryption: string;  // uci encryption value matching what the network announces
}

function dbmToBars(dbm: number): number {
  if (dbm >= -55) return 4;
  if (dbm >= -66) return 3;
  if (dbm >= -77) return 2;
  return dbm ? 1 : 0;
}

/** Map iwinfo's scan `encryption` object to the uci value a client needs. */
function uciEncryption(e: any): string {
  if (!e?.enabled) return 'none';
  const auth: string[] = (Array.isArray(e.authentication) ? e.authentication : []).map((a: unknown) => String(a).toLowerCase());
  const sae = auth.includes('sae'), psk = auth.includes('psk');
  if (sae && psk) return 'sae-mixed';
  if (sae) return 'sae';
  return 'psk2';
}

/** Scan on every radio, so a 5 GHz-only network is found and later joined on the 5 GHz radio. */
export async function scan(): Promise<ScanResult[]> {
  const radios = await loadWireless();
  const st = await wirelessStatus().catch(() => ({} as Record<string, any>));
  const map = new Map<string, ScanResult>();
  let answered = 0;
  let firstError: unknown = null;
  for (const radio of radios) {
    // iwinfo scans through a live interface name when the radio has one.
    const ifname = (st?.[radio.id]?.interfaces ?? []).map((i: any) => i?.ifname).find(Boolean);
    try {
      const r = await call<any>('iwinfo', 'scan', { device: ifname || radio.id });
      answered++;
      for (const x of r?.results ?? []) {
        const ssid = x.ssid || '(hidden)';
        const res: ScanResult = {
          ssid, signal: dbmToBars(x.signal ?? 0), locked: !!x?.encryption?.enabled, bssid: x.bssid || '',
          radio: radio.id, bandLabel: radio.bandLabel, encryption: uciEncryption(x.encryption)
        };
        const e = map.get(ssid);
        if (!e || res.signal > e.signal) map.set(ssid, res);
      }
    } catch (e) {
      firstError ??= e;
    }
  }
  if (!answered) throw firstError ?? new Error('No Wi-Fi radio available to scan');
  return [...map.values()].sort((a, b) => b.signal - a.signal);
}

/**
 * Join `n` as a client. Applied with a rollback window: on most radios the
 * access point follows the uplink's channel, so a wrong password or a network
 * out of range can take this router's own Wi-Fi down. If the user cannot
 * confirm, the router restores the previous settings by itself.
 */
export async function joinNetwork(n: ScanResult, key: string): Promise<void> {
  const bad = n.locked ? keyProblem(n.encryption, key) : '';
  if (bad) throw new Error(bad);

  const net = ((await uciGet('network')) as any)?.values ?? {};
  if (!net.wwan) await uciAdd('network', 'interface', 'wwan', { proto: 'dhcp' });

  // Reuse an existing client interface instead of stacking a new one per join.
  const wv = ((await uciGet('wireless')) as any)?.values ?? {};
  let staId: string | null = null;
  for (const [id, s] of Object.entries<any>(wv)) {
    if (s?.['.type'] === 'wifi-iface' && s.mode === 'sta') { staId = id; break; }
  }
  const cfg = {
    device: n.radio,
    mode: 'sta',
    network: 'wwan',
    ssid: n.ssid,
    encryption: n.locked ? n.encryption : 'none',
    key: n.locked ? key : ''
  };
  if (staId) await uciSet('wireless', staId, cfg);
  else await uciAdd('wireless', 'wifi-iface', undefined, cfg);

  // The uplink must sit in the masqueraded `wan` zone or nothing behind this
  // router can get out through it.
  await stageWanZone('wwan', true);
  await firewallApply(true);
}
