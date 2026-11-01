// Package + firmware info. OpenWRT 24.10 uses apk; there is no stable ubus
// method for it yet, so this calls the planned `untangled.sw` rpcd helper and
// degrades gracefully when the helper package isn't installed on the device.
import { call } from './ubus';

export interface FwInfo { firmware: string; kernel: string; target: string; }
export interface Pkg { name: string; version: string; installed: boolean; }

export async function getFirmware(): Promise<FwInfo> {
  const b = await call<any>('system', 'board');
  const rel = b?.release ?? {};
  return {
    firmware: rel.description || [rel.distribution, rel.version].filter(Boolean).join(' ') || 'OpenWRT',
    kernel: b?.kernel ?? '',
    target: rel.target ?? ''
  };
}

export interface SoftwareList { available: boolean; packages: Pkg[]; message?: string; }

export async function listPackages(): Promise<SoftwareList> {
  try {
    const r = await call<any>('untangled.sw', 'list', {});
    const pkgs: Pkg[] = (r?.packages ?? []).map((p: any) => ({
      name: String(p.name ?? ''),
      version: String(p.version ?? ''),
      installed: !!p.installed
    }));
    return { available: true, packages: pkgs };
  } catch {
    return {
      available: false,
      packages: [],
      message: 'The UnTangled package helper is not installed on this router yet. Install the `untangled` package to manage software from here.'
    };
  }
}

export async function pkgAction(action: 'install' | 'remove' | 'update', name?: string): Promise<void> {
  await call('untangled.sw', action, name ? { name } : {});
}
