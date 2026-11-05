// Minimal ubus JSON-RPC client for uhttpd-mod-ubus (the /ubus endpoint).
//
// Every call is: POST /ubus  { jsonrpc, id, method:"call", params:[session,obj,method,args] }
// and the reply's `result` is a tuple [status, data] where status 0 === OK.

export const UBUS_URL = '/ubus';
const NULL_SESSION = '00000000000000000000000000000000';

let sessionId = NULL_SESSION;
let rpcId = 1;

export function setSession(id: string) {
  sessionId = id;
}
export function getSession() {
  return sessionId;
}

// ubus status codes (ubus_msg_status)
const STATUS = [
  'OK', 'INVALID_COMMAND', 'INVALID_ARGUMENT', 'METHOD_NOT_FOUND', 'NOT_FOUND',
  'NO_DATA', 'PERMISSION_DENIED', 'TIMEOUT', 'NOT_SUPPORTED', 'UNKNOWN', 'CONNECTION_FAILED'
];

export class UbusError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'UbusError';
  }
}

export async function call<T = unknown>(
  object: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const body = {
    jsonrpc: '2.0',
    id: rpcId++,
    method: 'call',
    params: [sessionId, object, method, params]
  };

  const res = await fetch(UBUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new UbusError(-1, `HTTP ${res.status}`);

  const json = await res.json();
  if (json.error) throw new UbusError(json.error.code ?? -1, json.error.message ?? 'RPC error');

  const result = json.result;
  // Some ubus methods reply with just the data; most reply [status, data].
  if (Array.isArray(result)) {
    const [status, data] = result;
    if (status !== 0) throw new UbusError(status, STATUS[status] ?? `ubus status ${status}`);
    return data as T;
  }
  return result as T;
}

export interface LoginResult {
  ubus_rpc_session: string;
  timeout: number;
  expires: number;
  acls: Record<string, unknown>;
  data: { username: string };
}

/** Authenticate against rpcd's session object and keep the returned token. */
export async function login(username: string, password: string): Promise<LoginResult> {
  const prev = sessionId;
  sessionId = NULL_SESSION; // login always runs on the null session
  try {
    const data = await call<LoginResult>('session', 'login', { username, password });
    setSession(data.ubus_rpc_session);
    return data;
  } catch (e) {
    sessionId = prev;
    throw e;
  }
}

export async function logout(): Promise<void> {
  try {
    await call('session', 'destroy', {});
  } finally {
    setSession(NULL_SESSION);
  }
}

// ---- Convenience wrappers over UCI (used across screens) -------------------

export function uciGet(config: string, section?: string) {
  return call<Record<string, unknown>>('uci', 'get', section ? { config, section } : { config });
}
export function uciSet(config: string, section: string, values: Record<string, unknown>) {
  return call('uci', 'set', { config, section, values });
}
export function uciAdd(config: string, type: string, name: string | undefined, values: Record<string, unknown> = {}) {
  return call<{ section: string }>('uci', 'add', name ? { config, type, name, values } : { config, type, values });
}
export function uciDelete(config: string, section: string, option?: string) {
  return call('uci', 'delete', option ? { config, section, option } : { config, section });
}
/** Commit staged changes and reload affected services (no rollback window). */
export function uciApply() {
  return call('uci', 'apply', { rollback: false });
}
/** Apply with a rollback timer: if uciConfirm isn't called within `timeout`
 *  seconds, the router restores the previous config. Prevents lockouts.
 *  Keep this LONGER than the UI confirm countdown (confirm.ts, 90s) so a
 *  last-second "Keep" reaches the router before it auto-reverts. */
export function uciApplyRollback(timeout = 120) {
  return call('uci', 'apply', { rollback: true, timeout });
}
/** Keep changes applied with uciApplyRollback (cancels the revert timer). */
export function uciConfirm() {
  return call('uci', 'confirm', {});
}
/** Immediately roll back changes applied with uciApplyRollback. */
export function uciRollback() {
  return call('uci', 'rollback', {});
}

/** Apply firewall UCI and make nftables reflect it. `uci apply` alone does not
 *  reliably rebuild fw4's ruleset for added/removed rules, so kick the service
 *  like the other service paths do (usb/system/ddns). Best-effort reload. */
export async function firewallApply(rollback = false, timeout = 120) {
  await (rollback ? uciApplyRollback(timeout) : uciApply());
  await call('file', 'exec', { command: '/etc/init.d/firewall', params: ['reload'] }).catch(() => {});
}
