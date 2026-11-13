import { call, uciSet, uciApplyRollback } from './ubus';

export interface LanCfg {
  ipaddr: string; netmask: string;
  dhcp: boolean; start: string; limit: string; leasetime: string;
}

function prefixToMask(p: number): string {
  const n = Math.min(32, Math.max(0, Math.trunc(p) || 0));
  const m = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
  return [24, 16, 8, 0].map((s) => (m >>> s) & 255).join('.');
}

export async function loadLan(): Promise<LanCfg> {
  const [n, d] = await Promise.all([
    call<any>('uci', 'get', { config: 'network', section: 'lan' }).catch(() => ({ values: {} })),
    call<any>('uci', 'get', { config: 'dhcp', section: 'lan' }).catch(() => ({ values: {} }))
  ]);
  const nv = n?.values ?? {};
  const dv = d?.values ?? {};
  // Newer OpenWrt (25.x/snapshot) stores `list ipaddr '192.168.1.1/24'`
  // instead of ipaddr + netmask; show both shapes as address + mask.
  const raw = String((Array.isArray(nv.ipaddr) ? nv.ipaddr[0] : nv.ipaddr) ?? '192.168.1.1');
  const [addr, prefix] = raw.split('/');
  return {
    ipaddr: addr,
    netmask: prefix ? prefixToMask(+prefix) : (nv.netmask ?? '255.255.255.0'),
    dhcp: dv.ignore !== '1',
    start: String(dv.start ?? '100'),
    limit: String(dv.limit ?? '150'),
    leasetime: String(dv.leasetime ?? '12h')
  };
}

export async function saveLan(c: LanCfg): Promise<void> {
  await uciSet('network', 'lan', { ipaddr: c.ipaddr, netmask: c.netmask });
  await uciSet('dhcp', 'lan', { ignore: c.dhcp ? '0' : '1', start: c.start, limit: c.limit, leasetime: c.leasetime });
  await uciApplyRollback();
}
