import { call, uciSet, uciApply } from './ubus';

// On-device "safety" services. Each maps to a package's uci config; if the
// package isn't installed, the config read fails and we mark it unavailable.
export interface Feature {
  id: string;
  label: string;
  desc: string;
  pkg: string;
  config: string;
  section: string;
  option: string;
  installed: boolean;
  enabled: boolean;
}

const DEFS: Omit<Feature, 'installed' | 'enabled'>[] = [
  { id: 'adblock', label: 'Block ads & trackers', desc: 'Removes most ads and hidden trackers for every device.', pkg: 'adblock', config: 'adblock', section: 'global', option: 'adb_enabled' },
  { id: 'banip', label: 'Block dangerous sites', desc: 'Blocks known malicious and abuse IPs using threat feeds.', pkg: 'banip', config: 'banip', section: 'global', option: 'ban_enabled' }
];

function findGlobal(values: any, type: string): { id: string; s: any } | null {
  for (const [id, s] of Object.entries<any>(values ?? {})) {
    if (s?.['.type'] === type) return { id, s };
  }
  return null;
}

export async function loadProtection(): Promise<Feature[]> {
  const out: Feature[] = [];
  for (const d of DEFS) {
    try {
      const r = await call<any>('uci', 'get', { config: d.config });
      const g = findGlobal(r?.values, d.config);
      const section = g?.id ?? d.section;
      const enabled = (g?.s?.[d.option] ?? '0') === '1';
      out.push({ ...d, section, installed: true, enabled });
    } catch {
      out.push({ ...d, installed: false, enabled: false });
    }
  }
  return out;
}

export async function setFeature(f: Feature, on: boolean): Promise<void> {
  await uciSet(f.config, f.section, { [f.option]: on ? '1' : '0' });
  await uciApply();
}
