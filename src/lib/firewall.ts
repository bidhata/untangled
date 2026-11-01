// Firewall zones + DMZ, via the uci ubus object (fw4 / nftables on 24.10).
import { call, uciSet, uciAdd, uciDelete, uciApply, uciApplyRollback } from './ubus';

const truthy = (v: unknown) => v === '1' || v === 1 || v === true;
function toArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) return v.trim().split(/\s+/);
  return [];
}

export type Policy = 'ACCEPT' | 'REJECT' | 'DROP';

export interface FwZone {
  id: string;
  name: string;
  input: Policy;
  output: Policy;
  forward: Policy;
  masq: boolean;
  networks: string[];
}
export interface FwForward { id: string; src: string; dest: string; }

export async function loadFirewall(): Promise<{ zones: FwZone[]; forwards: FwForward[] }> {
  const r = await call<any>('uci', 'get', { config: 'firewall' });
  const values = r?.values ?? r ?? {};
  const zones: FwZone[] = [];
  const forwards: FwForward[] = [];
  for (const [id, s] of Object.entries<any>(values)) {
    if (s?.['.type'] === 'zone') {
      zones.push({
        id,
        name: s.name ?? id,
        input: (s.input ?? 'ACCEPT') as Policy,
        output: (s.output ?? 'ACCEPT') as Policy,
        forward: (s.forward ?? 'REJECT') as Policy,
        masq: truthy(s.masq),
        networks: toArr(s.network)
      });
    } else if (s?.['.type'] === 'forwarding') {
      forwards.push({ id, src: s.src ?? '', dest: s.dest ?? '' });
    }
  }
  return { zones, forwards };
}

export async function saveZone(z: FwZone): Promise<void> {
  await uciSet('firewall', z.id, {
    input: z.input,
    output: z.output,
    forward: z.forward,
    masq: z.masq ? '1' : '0'
  });
  await uciApplyRollback();
}

// ---- DMZ (a full-cone DNAT of all WAN inbound to one host) -----------------
export interface DmzState { enabled: boolean; host: string; redirectId: string | null; }

export async function loadDmz(): Promise<DmzState> {
  const r = await call<any>('uci', 'get', { config: 'firewall' });
  const values = r?.values ?? r ?? {};
  for (const [id, s] of Object.entries<any>(values)) {
    if (s?.['.type'] === 'redirect' && (s.name === 'DMZ' || s.name === 'dmz' || id === 'dmz')) {
      return { enabled: s.enabled !== '0', host: s.dest_ip ?? '', redirectId: id };
    }
  }
  return { enabled: false, host: '', redirectId: null };
}

export async function setDmz(host: string): Promise<void> {
  const cur = await loadDmz();
  if (cur.redirectId) {
    await uciSet('firewall', cur.redirectId, { dest_ip: host, enabled: '1' });
  } else {
    await uciAdd('firewall', 'redirect', 'dmz', {
      name: 'DMZ',
      src: 'wan',
      dest: 'lan',
      proto: 'all',
      target: 'DNAT',
      dest_ip: host
    });
  }
  await uciApplyRollback();
}

export async function clearDmz(): Promise<void> {
  const cur = await loadDmz();
  if (cur.redirectId) {
    await uciDelete('firewall', cur.redirectId);
    await uciApply();
  }
}

// ---- Port forwarding (DNAT redirects with an external port) ----------------
export interface PortFwd {
  id: string; name: string; proto: string; port: string; destIp: string; enabled: boolean;
}

function protoCanon(v: unknown): string {
  const a = toArr(v).map((x) => x.toLowerCase());
  return a.includes('tcp') && a.includes('udp') ? 'tcp udp' : a[0] || 'tcp';
}
function protoVal(p: string): string | string[] {
  return p === 'tcp udp' ? ['tcp', 'udp'] : p;
}
function isDmzLike(s: any, id: string): boolean {
  return s.name === 'DMZ' || s.name === 'dmz' || id === 'dmz' || (String(s.proto) === 'all' && !s.src_dport);
}

export async function loadPortForwards(): Promise<PortFwd[]> {
  const r = await call<any>('uci', 'get', { config: 'firewall' });
  const values = r?.values ?? r ?? {};
  const out: PortFwd[] = [];
  for (const [id, s] of Object.entries<any>(values)) {
    if (s?.['.type'] !== 'redirect') continue;
    if (String(s.target ?? 'DNAT').toUpperCase() !== 'DNAT') continue;
    if (isDmzLike(s, id) || !s.src_dport) continue;
    out.push({
      id,
      name: s.name ?? '',
      proto: protoCanon(s.proto),
      port: String(s.src_dport ?? ''),
      destIp: s.dest_ip ?? '',
      enabled: s.enabled !== '0'
    });
  }
  return out;
}

export async function addPortForward(p: Omit<PortFwd, 'id' | 'enabled'>): Promise<void> {
  await uciAdd('firewall', 'redirect', undefined, {
    name: p.name,
    src: 'wan',
    dest: 'lan',
    target: 'DNAT',
    proto: protoVal(p.proto),
    src_dport: p.port,
    dest_ip: p.destIp,
    dest_port: p.port
  });
  await uciApply();
}

export async function savePortForward(p: PortFwd): Promise<void> {
  await uciSet('firewall', p.id, {
    name: p.name,
    proto: protoVal(p.proto),
    src_dport: p.port,
    dest_ip: p.destIp,
    dest_port: p.port,
    enabled: p.enabled ? '1' : '0'
  });
  await uciApply();
}

export async function deletePortForward(id: string): Promise<void> {
  await uciDelete('firewall', id);
  await uciApply();
}
