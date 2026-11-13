// Small input checks shared by the screens. Each returns true/false; the screen
// decides the wording. The router accepts almost anything into UCI and only
// fails later (or silently skips the rule), so check before saving.

const OCTET = '(25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const IPV4_RE = new RegExp(`^(${OCTET}\\.){3}${OCTET}$`);

export function isIpv4(s: string): boolean {
  return IPV4_RE.test(s.trim());
}

/** A contiguous IPv4 netmask such as 255.255.255.0 (not 0.0.0.0, not 255.0.255.0). */
export function isNetmask(s: string): boolean {
  if (!isIpv4(s)) return false;
  const n = s.trim().split('.').reduce((a, o) => (a << 8) | +o, 0) >>> 0;
  if (n === 0) return false;
  const inv = ~n >>> 0;
  return (inv & (inv + 1)) === 0;
}

export function isIpv6(s: string): boolean {
  const v = s.trim();
  if (!v || v.length > 45 || !v.includes(':')) return false;
  return /^[0-9a-fA-F:.]+$/.test(v) && (v.match(/::/g)?.length ?? 0) <= 1;
}

/** One port (1-65535) or a range "a-b" / "a:b" with a <= b. */
export function isPortOrRange(s: string): boolean {
  const m = s.trim().match(/^(\d{1,5})(?:[-:](\d{1,5}))?$/);
  if (!m) return false;
  const a = +m[1], b = m[2] === undefined ? a : +m[2];
  return a >= 1 && b <= 65535 && a <= b;
}

/** A whole number within [min, max]. */
export function isIntIn(s: string | number, min: number, max: number): boolean {
  const t = String(s).trim();
  return /^\d+$/.test(t) && +t >= min && +t <= max;
}

/** dnsmasq lease time: 12h, 30m, 7d, a number of seconds, or "infinite". */
export function isLeaseTime(s: string): boolean {
  return /^(\d+[smhdw]?|infinite)$/.test(s.trim());
}
