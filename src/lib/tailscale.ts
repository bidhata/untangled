// Tailscale: a mesh VPN that reaches your network from anywhere. Managed via
// the `tailscale` CLI over file.exec (needs the `tailscale` package). Status is
// read from `tailscale status --json`; up/down toggle the connection. Logging
// in is interactive (Tailscale prints an auth URL you open in a browser), so we
// surface that URL rather than trying to complete auth from the router.
import { call } from './ubus';

export interface TsPeer {
  name: string;
  ip: string;
  os: string;
  online: boolean;
  self: boolean;
}
export interface TsStatus {
  installed: boolean;
  state: 'running' | 'stopped' | 'needslogin' | 'unknown';
  selfIp: string;
  selfName: string;
  tailnet: string;
  peers: TsPeer[];
  authUrl: string | null;
}

const EMPTY: TsStatus = {
  installed: false, state: 'unknown', selfIp: '', selfName: '',
  tailnet: '', peers: [], authUrl: null
};

interface ExecResult { code: number; stdout: string; stderr: string; }
async function exec(command: string, params: string[]): Promise<ExecResult | null> {
  try {
    const r = await call<any>('file', 'exec', { command, params });
    return {
      code: typeof r?.code === 'number' ? r.code : 0,
      stdout: String(r?.stdout ?? ''),
      stderr: String(r?.stderr ?? '')
    };
  } catch {
    return null;
  }
}

function firstIp(ips: unknown): string {
  if (Array.isArray(ips)) {
    // Prefer the 100.x.y.z IPv4 CGNAT address.
    const v4 = ips.find((x) => /^100\./.test(String(x)));
    return String(v4 ?? ips[0] ?? '');
  }
  return '';
}

export async function loadTailscale(): Promise<TsStatus> {
  const r = await exec('tailscale', ['status', '--json']);
  if (!r) return EMPTY;                       // file.exec unavailable
  // Command missing -> non-zero with empty stdout, or shell "not found".
  if (!r.stdout.trim()) {
    if (/not found|No such file/i.test(r.stderr)) return EMPTY;
    return { ...EMPTY, installed: /tailscale/i.test(r.stderr) };
  }

  let j: any;
  try { j = JSON.parse(r.stdout); } catch { return { ...EMPTY, installed: true }; }

  const backend = String(j?.BackendState ?? '').toLowerCase();
  const state: TsStatus['state'] =
    backend === 'running' ? 'running'
    : backend === 'needslogin' ? 'needslogin'
    : backend === 'stopped' ? 'stopped'
    : 'unknown';

  const self = j?.Self ?? {};
  const peers: TsPeer[] = [];
  if (self?.HostName || self?.TailscaleIPs) {
    peers.push({
      name: String(self.HostName ?? 'this router'),
      ip: firstIp(self.TailscaleIPs),
      os: String(self.OS ?? ''),
      online: !!self.Online,
      self: true
    });
  }
  for (const p of Object.values<any>(j?.Peer ?? {})) {
    peers.push({
      name: String(p?.HostName ?? p?.DNSName ?? '').replace(/\.$/, '') || '(peer)',
      ip: firstIp(p?.TailscaleIPs),
      os: String(p?.OS ?? ''),
      online: !!p?.Online,
      self: false
    });
  }

  const magicDns = j?.CurrentTailnet?.Name ?? j?.MagicDNSSuffix ?? '';

  return {
    installed: true,
    state,
    selfIp: firstIp(self?.TailscaleIPs),
    selfName: String(self?.HostName ?? ''),
    tailnet: String(magicDns ?? ''),
    peers,
    authUrl: j?.AuthURL ? String(j.AuthURL) : null
  };
}

/** Bring Tailscale up. Returns an auth URL if the node needs to be logged in.
 *  --timeout keeps the call from blocking: on a node that needs login,
 *  `tailscale up` would otherwise sit in the foreground until authenticated
 *  and hang the rpcd exec. It still prints the login URL before returning. */
export async function tailscaleUp(): Promise<{ authUrl: string | null }> {
  const r = await exec('tailscale', ['up', '--accept-routes', '--timeout=5s']);
  if (!r) throw new Error('tailscale command unavailable');
  const text = r.stdout + '\n' + r.stderr;
  const m = text.match(/https:\/\/login\.tailscale\.com\/\S+/);
  if (m) return { authUrl: m[0] };          // needs login — not an error
  if (r.code !== 0) throw new Error(r.stderr || `exit ${r.code}`);
  return { authUrl: null };
}

export async function tailscaleDown(): Promise<void> {
  const r = await exec('tailscale', ['down']);
  if (!r) throw new Error('tailscale command unavailable');
  if (r.code !== 0) throw new Error(r.stderr || `exit ${r.code}`);
}
