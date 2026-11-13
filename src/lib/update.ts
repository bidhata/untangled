// Self-update: bring the UnTangled packages (and only those) up to the version
// in the signed package feed, from the browser.
//
// Deliberately narrow. The rpcd ACL grants exactly these command lines and no
// others, for opkg (OpenWrt 23.05 / 24.10) and apk (25.12+ and snapshot):
//     <pm> update
//     <pm> list-upgradable            (apk: list --upgradable)
//     opkg upgrade <name>  /  apk add --upgrade <name>
//         for <name> = untangled | untangled-full | untangled-mesh
// so this can never install or upgrade an arbitrary package. The feed itself is
// signed and the router verifies it, exactly as on the command line.
import { call } from './ubus';

export type PackageManager = 'opkg' | 'apk';
const OURS = ['untangled', 'untangled-full', 'untangled-mesh'];

export interface UpdateItem { name: string; from: string; to: string; }
export interface UpdateCheck {
  pm: PackageManager | null;
  /** Is the UnTangled feed configured? null = could not tell. */
  feed: boolean | null;
  installed: { name: string; version: string }[];
  items: UpdateItem[];
  /** Plain-language reason the check could not complete, if it could not. */
  problem: string;
}

interface Exec { code: number; stdout: string; stderr: string; }
async function run(command: string, params: string[]): Promise<Exec> {
  const r = await call<any>('file', 'exec', { command, params });
  return { code: typeof r?.code === 'number' ? r.code : 0, stdout: String(r?.stdout ?? ''), stderr: String(r?.stderr ?? '') };
}

// `opkg list-installed` -> "untangled - 0.1.16-1"
function parseOpkgInstalled(out: string) {
  return out.split('\n').map((l) => l.trim().match(/^(\S+)\s+-\s+(\S+)/)).filter((m): m is RegExpMatchArray => !!m && OURS.includes(m[1]))
    .map((m) => ({ name: m[1], version: m[2] }));
}
// `apk list --installed` -> "untangled-full-0.1.16-r1 noarch {untangled} (GPL-2.0-or-later) [installed]"
function parseApkInstalled(out: string) {
  return out.split('\n').map((l) => l.trim().match(/^(untangled(?:-full|-mesh)?)-(\d\S*)\s/)).filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ name: m[1], version: m[2] }));
}
// `opkg list-upgradable` -> "untangled - 0.1.16-1 - 0.1.17-1"
export function parseOpkgUpgradable(out: string): UpdateItem[] {
  return out.split('\n').map((l) => l.trim().match(/^(\S+)\s+-\s+(\S+)\s+-\s+(\S+)$/)).filter((m): m is RegExpMatchArray => !!m && OURS.includes(m[1]))
    .map((m) => ({ name: m[1], from: m[2], to: m[3] }));
}
// `apk list --upgradable` -> "untangled-0.1.17-r1 noarch {…} (…) [upgradable from: untangled-0.1.16-r1]"
export function parseApkUpgradable(out: string): UpdateItem[] {
  const items: UpdateItem[] = [];
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(untangled(?:-full|-mesh)?)-(\d\S*)\s.*\[upgradable from:\s*(\S+?)\]/);
    if (m && m[3].startsWith(m[1] + '-')) items.push({ name: m[1], to: m[2], from: m[3].slice(m[1].length + 1) });
  }
  return items;
}

async function installed(): Promise<{ pm: PackageManager | null; list: { name: string; version: string }[] }> {
  try {
    const o = await run('opkg', ['list-installed']);
    if (o.code === 0 && o.stdout.trim()) return { pm: 'opkg', list: parseOpkgInstalled(o.stdout) };
  } catch { /* not an opkg system */ }
  for (const args of [['list', '--installed'], ['list', '-I']]) {
    try {
      const a = await run('apk', args);
      if (a.code === 0 && a.stdout.trim()) return { pm: 'apk', list: parseApkInstalled(a.stdout) };
    } catch { /* try the next form */ }
  }
  return { pm: null, list: [] };
}

/** Whether the UnTangled feed is set up (the README's install steps add it). */
async function feedConfigured(pm: PackageManager): Promise<boolean | null> {
  const path = pm === 'opkg' ? '/etc/opkg/customfeeds.conf' : '/etc/apk/repositories.d/untangled.list';
  try {
    const r = await call<any>('file', 'read', { path });
    const lines = String(r?.data ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return lines.some((l) => /untangled/i.test(l));
  } catch (e: any) {
    if (e?.code === 4) return false;   // file absent: feed never added
    return null;                        // unreadable for another reason: unknown
  }
}

/**
 * Refresh the package lists (this contacts the internet, so it only runs when
 * the person asks) and report which UnTangled packages have a newer version.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const { pm, list } = await installed();
  const base: UpdateCheck = { pm, feed: null, installed: list, items: [], problem: '' };
  if (!pm) return { ...base, problem: "Could not find the router's package manager (opkg or apk)." };

  base.feed = await feedConfigured(pm);
  if (base.feed === false) return base;

  let refreshed: Exec;
  try {
    refreshed = await run(pm, ['update']);
  } catch (e: any) {
    const why = e?.code === 6
      ? 'This router does not allow updating from the web interface yet. Update once from the command line; later updates can be done here.'
      : e?.code === 7
        ? 'The router took too long to reach the package feed. Check its internet connection and try again.'
        : 'Could not refresh the package list from the router.';
    return { ...base, problem: why };
  }

  const up = await run(pm, pm === 'opkg' ? ['list-upgradable'] : ['list', '--upgradable']);
  base.items = pm === 'opkg' ? parseOpkgUpgradable(up.stdout) : parseApkUpgradable(up.stdout);
  // Only ever act on what is already installed: `opkg upgrade <name>` INSTALLS a
  // package that is absent, and a self-update must not add packages.
  base.items = base.items.filter((i) => list.some((p) => p.name === i.name));
  // A failed refresh with nothing to offer is "could not check", not "up to date".
  if (!base.items.length && refreshed.code !== 0) {
    base.problem = 'Could not reach the package feed. Check that the router is online and try again.';
  }
  return base;
}

// apk: `add --upgrade`, not `upgrade`. A package installed from a downloaded
// .apk file is pinned in /etc/apk/world to that exact file, and `apk upgrade
// <name>` then silently does nothing; `add --upgrade` replaces the pin with the
// feed's version. (Both forms would INSTALL an absent package, which is why
// only already-installed names are ever passed here.)
function upgradeArgs(pm: PackageManager, name: string): string[] {
  return pm === 'opkg' ? ['upgrade', name] : ['add', '--upgrade', name];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Upgrade the given packages one at a time, the core package last (it replaces
 * the files of the page that is running this). The install scripts of the core
 * and mesh packages reload rpcd, which drops (or never sends) the reply to the
 * very call that started them, so each step is judged by reading the installed
 * version back, not by the call's result.
 */
export async function applyUpdate(check: UpdateCheck, onStep: (msg: string) => void = () => {}): Promise<void> {
  const pm = check.pm;
  if (!pm) throw new Error('No package manager');
  const order = [...check.items].sort((a, b) => Number(a.name === 'untangled') - Number(b.name === 'untangled'));
  for (const item of order) {
    onStep(`Updating ${item.name} to ${item.to}…`);
    // Start the upgrade but do not wait on its reply: when the package's install
    // script reloads rpcd, uhttpd can leave this request hanging forever.
    let finished: Exec | 'lost' | null = null;
    run(pm, upgradeArgs(pm, item.name)).then((r) => (finished = r), () => (finished = 'lost'));

    // Watch the installed version instead. Give up ~10 s after the command has
    // reported back without the version changing, or after ~90 s in any case.
    let done = false;
    let graceLeft = 5;
    for (let i = 0; i < 45 && !done && graceLeft > 0; i++) {
      await sleep(2000);
      try {
        // A read sent while rpcd is reloading can hang as well; never wait on one for long.
        const state = await Promise.race([installed(), sleep(6000).then(() => null)]);
        const now = state?.list.find((p) => p.name === item.name);
        done = !!now && now.version === item.to;
      } catch { /* rpcd still coming back */ }
      if (finished !== null) graceLeft--;
    }
    const f = finished as Exec | 'lost' | null;
    const detail = f && f !== 'lost' && f.code !== 0 ? (f.stderr || f.stdout).trim().split('\n').slice(-2).join(' ') : '';
    if (!done) throw new Error(`${item.name} did not update${detail ? `: ${detail}` : '. Check the router\'s internet connection and try again.'}`);
  }
}
