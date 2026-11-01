// Firmware upgrade (sysupgrade). Uploads an image to /tmp via cgi-io, validates
// it with rpc-sys, then flashes it keeping (or wiping) settings. Needs
// rpcd-mod-rpcsys and the cgi-io package (/cgi-bin/cgi-upload).
import { call, getSession } from './ubus';
import { getBoard } from './net';

export interface FwInfo { model: string; firmware: string; }

export async function firmwareInfo(): Promise<FwInfo> {
  const b = await getBoard();
  return { model: b.model, firmware: b.firmware };
}

export interface UploadResult { size: number; checksum: string; sha256sum?: string }

/** Upload the image to /tmp/firmware.img through cgi-io. */
export async function uploadFirmware(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append('sessionid', getSession());
  fd.append('filename', '/tmp/firmware.img');
  fd.append('filemode', '600');
  fd.append('filedata', file, file.name);
  const res = await fetch('/cgi-bin/cgi-upload', { method: 'POST', body: fd });
  if (res.status === 404) throw new Error('cgi-io missing');
  if (!res.ok) throw new Error(`upload failed (HTTP ${res.status})`);
  return res.json();
}

export interface TestResult { code: number; stdout: string; stderr: string }

/** Ask the router whether the uploaded image is valid for this device. */
export async function testFirmware(): Promise<TestResult> {
  const r = await call<any>('rpc-sys', 'upgrade_test', {});
  return { code: Number(r?.code ?? 0), stdout: String(r?.stdout ?? ''), stderr: String(r?.stderr ?? '') };
}

/** Begin the flash. The device reboots; the HTTP connection will drop. */
export async function flashFirmware(keepSettings: boolean): Promise<void> {
  await call('rpc-sys', 'upgrade_start', { keep: keepSettings });
}

/** Remove a staged image if the user cancels. */
export async function cleanFirmware(): Promise<void> {
  await call('rpc-sys', 'upgrade_clean', {}).catch(() => {});
}
