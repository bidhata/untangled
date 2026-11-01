import { call, uciSet, uciApply } from './ubus';

// Simplified IPv6 control: enable/disable the IPv6 WAN, and choose how the LAN
// hands out IPv6 (off / server / relay). Maps to network.wan6 + dhcp.lan ra/dhcpv6.
export interface Ipv6Cfg { wanEnabled: boolean; lanMode: string; hasWan6: boolean; }

export async function loadIpv6(): Promise<Ipv6Cfg> {
  const [w, d] = await Promise.all([
    call<any>('uci', 'get', { config: 'network', section: 'wan6' }).catch(() => null),
    call<any>('uci', 'get', { config: 'dhcp', section: 'lan' }).catch(() => ({ values: {} }))
  ]);
  const wv = w?.values ?? null;
  const dv = d?.values ?? {};
  return {
    hasWan6: !!wv,
    wanEnabled: wv ? wv.disabled !== '1' : true,
    lanMode: String(dv.ra ?? dv.dhcpv6 ?? 'server')
  };
}

export async function saveIpv6(c: Ipv6Cfg): Promise<void> {
  if (c.hasWan6) await uciSet('network', 'wan6', { disabled: c.wanEnabled ? '0' : '1' }).catch(() => {});
  const mode = c.lanMode; // 'server' | 'relay' | 'disabled'
  await uciSet('dhcp', 'lan', { ra: mode, dhcpv6: mode });
  await uciApply();
}
