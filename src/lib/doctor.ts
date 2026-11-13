// Network Doctor: a one-shot battery of read-only health checks over state the
// app already fetches (net.ts). Runs in the browser; the router only answers a
// handful of cheap ubus reads, once per run. No writes, no polling — diagnosis
// only. Each check returns one Finding; the UI renders one line per finding.
import { getWan, getSysInfo, getPublicIp, isPrivateIp, getClients, getLog, wifiDiag, wifiAbsent } from './net';

export type Severity = 'ok' | 'warn' | 'crit';

export interface Finding {
  id: string;
  title: string;    // plain-language, one sentence
  severity: Severity;
  detail?: string;  // optional extra context (log lines, the raw diag string)
  screen?: string;  // nav id to jump to for the fix, when there is one
}

// Thresholds kept conservative and visible. memUsedPct is Linux "used incl.
// cache" via net.ts (total-available), so only flag when genuinely high.
const MEM_WARN = 90;

export async function runChecks(): Promise<Finding[]> {
  const out: Finding[] = [];

  // 1–3. WAN reachability, DNS, and CGNAT/double-NAT — all from one dump.
  try {
    const wan = await getWan();
    if (!wan.up) {
      out.push({ id: 'wan', title: 'Internet connection (WAN) is down.', severity: 'crit', screen: 'wan' });
    } else if (!wan.ipv4) {
      out.push({ id: 'wan', title: 'WAN is up but has no IP address yet.', severity: 'crit', screen: 'wan' });
    } else {
      out.push({ id: 'wan', title: 'Internet connection is up.', severity: 'ok' });
      if (!wan.dns.length) {
        out.push({ id: 'dns', title: 'No DNS servers on the WAN — names may not resolve.', severity: 'warn', screen: 'wan' });
      }
      // CGNAT: WAN IP is private AND the public echo returns a different, public IP.
      if (isPrivateIp(wan.ipv4)) {
        const pub = await getPublicIp();
        if (pub && !isPrivateIp(pub)) {
          out.push({
            id: 'cgnat',
            title: 'Your ISP puts you behind carrier-grade NAT.',
            severity: 'warn',
            detail: `WAN address ${wan.ipv4} is private; the internet sees ${pub}. Port forwarding and inbound VPN will not work.`
          });
        }
      }
    }
  } catch {
    out.push({ id: 'wan', title: 'Could not read the WAN status from the router.', severity: 'warn', screen: 'wan' });
  }

  // 4. Memory pressure.
  try {
    const sys = await getSysInfo();
    if (sys.memUsedPct >= MEM_WARN) {
      out.push({ id: 'mem', title: `Memory is ${sys.memUsedPct}% used — services may restart under load.`, severity: 'warn' });
    } else {
      out.push({ id: 'mem', title: `Memory use is healthy (${sys.memUsedPct}%).`, severity: 'ok' });
    }
  } catch {
    out.push({ id: 'mem', title: 'Could not read system memory info.', severity: 'warn' });
  }

  // 5. Wireless subsystem answered. getClients() populates net.ts's wifiDiag
  //    live binding: '' means the radios answered, otherwise it holds the first
  //    problem (e.g. a hostapd error) that the rest of the UI only whispers.
  try {
    await getClients();
    if (wifiAbsent) {
      out.push({ id: 'wifi', title: 'This router has no Wi-Fi radios (wired only).', severity: 'ok' });
    } else if (wifiDiag) {
      out.push({ id: 'wifi', title: 'The Wi-Fi subsystem did not report cleanly.', severity: 'warn', detail: wifiDiag, screen: 'wireless' });
    } else {
      out.push({ id: 'wifi', title: 'Wi-Fi radios are responding.', severity: 'ok' });
    }
  } catch {
    out.push({ id: 'wifi', title: 'Could not query the Wi-Fi subsystem.', severity: 'warn', screen: 'wireless' });
  }

  // 6. Error-level events in the recent system log (level <= 3 = err/crit/
  //    alert/emerg; getLog strips the syslog facility). Catches things like a flapping STA uplink (BEACON-LOSS).
  try {
    const log = await getLog(200);
    const errs = log.filter((e) => e.priority <= 3);
    if (errs.length) {
      out.push({
        id: 'log',
        title: `${errs.length} error-level event${errs.length > 1 ? 's' : ''} in the recent system log.`,
        severity: errs.length >= 10 ? 'crit' : 'warn',
        detail: errs.slice(-5).map((e) => e.msg).join('\n'),
        screen: 'log'
      });
    } else {
      out.push({ id: 'log', title: 'No error-level events in the recent system log.', severity: 'ok' });
    }
  } catch {
    out.push({ id: 'log', title: 'Could not read the system log.', severity: 'warn', screen: 'log' });
  }

  return out;
}

/** Worst severity across findings, for the screen's overall headline. */
export function overall(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === 'crit')) return 'crit';
  if (findings.some((f) => f.severity === 'warn')) return 'warn';
  return 'ok';
}

// --- self-check (assert-based; runs only when explicitly invoked) -----------
// Guards the pure severity-rollup logic, the one bit of non-trivial branching
// here that isn't just reading ubus. Call from a dev console if needed.
export function _selfCheck(): void {
  const S = (sev: Severity): Finding => ({ id: 'x', title: '', severity: sev });
  console.assert(overall([]) === 'ok', 'empty -> ok');
  console.assert(overall([S('ok'), S('ok')]) === 'ok', 'all ok -> ok');
  console.assert(overall([S('ok'), S('warn')]) === 'warn', 'any warn -> warn');
  console.assert(overall([S('warn'), S('crit')]) === 'crit', 'any crit -> crit');
}
