// usage: node ui-checks.cjs <container> <port>   (run.sh does this, last: it
// deletes dhcp.lan to force a failed save, and ends by restarting rpcd)
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs');
const C = process.argv[2], PORT = process.argv[3];
const HN = 'Host' + (Date.now() % 100000);
const dx = (cmd) => execFileSync('docker', ['exec', C, 'sh', '-c', cmd + '; true']).toString().trim();
const res = [];
const ok = (name, pass, info = '') => { res.push(pass); console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  -- ' + info : '')); };
const flat = (s) => s.replace(/\n/g, ' | ');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  // Toasts vanish after 2.8s, so record every toast as it appears.
  await pg.addInitScript(() => {
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent.trim());
      }))).observe(document.body, { childList: true, subtree: true });
    });
  });
  const lastToast = async () => { await pg.waitForTimeout(900); return pg.evaluate(() => window.__toasts[window.__toasts.length - 1] || ''); };
  const nav = async (id, h1) => {
    await pg.evaluate((i) => { location.hash = '#' + i; }, id);
    await pg.waitForSelector('h1:has-text("' + h1 + '")');
    await pg.waitForTimeout(900);
  };

  await pg.goto('http://127.0.0.1:' + PORT + '/untangled/');
  await pg.fill('input[autocomplete="username"]', 'ut');
  await pg.fill('input[type="password"]', 'test1234');
  await pg.keyboard.press('Enter');
  await pg.waitForSelector('.sidebar');

  // 1. session restore keeps the real username
  await pg.reload();
  await pg.waitForSelector('.sidebar');
  const who = (await pg.textContent('.topbar .tbtn:last-child')).trim();
  ok('reload keeps session + username', who === 'ut', 'topbar shows "' + who + '"');

  // 2. scheduled reboot -> crontab perms; Singapore timezone
  // rpcd applies the file mode only when it creates the file, so start without one.
  dx('rm -f /etc/crontabs/root');
  await nav('admin', 'Administration');
  await pg.locator('.panel:has(h2:has-text("Scheduled reboot")) input[type="checkbox"]').check({ force: true });
  await pg.click('button:has-text("Save schedule")');
  await pg.waitForTimeout(1500);
  const ls = dx('ls -l /etc/crontabs/root; cat /etc/crontabs/root');
  ok('crontab written 0600 with reboot line', /^-rw-------/.test(ls) && /untangled-reboot/.test(ls), flat(ls));
  await pg.selectOption('select:has(option[value="Asia/Singapore"])', 'Asia/Singapore');
  await pg.locator('.panel:has(h2:has-text("General")) button:has-text("Apply")').click({ timeout: 3000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  const tz = dx('uci get system.@system[0].timezone; date +%z');
  ok('Singapore timezone is a valid +8', /<\+08>-8/.test(tz) && /\+0800/.test(tz), flat(tz));

  // 3. backup download
  await nav('firmware', 'Firmware');
  const [dl] = await Promise.all([
    pg.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    pg.click('button:has-text("Download backup")')
  ]);
  let size = 0, name = '';
  if (dl) { size = fs.statSync(await dl.path()).size; name = dl.suggestedFilename(); }
  ok('config backup downloads', !!dl && size > 500, dl ? name + ', ' + size + ' bytes' : 'no download; toast: ' + (await lastToast()));

  // 4. a failed save must not leak into the next apply
  dx('uci delete dhcp.lan; uci commit dhcp');
  const lanBefore = dx('uci get network.lan.ipaddr'); // '192.168.1.1' or, on 25.12+, '192.168.1.1/24'
  await nav('lan', 'LAN');
  await pg.locator('.form-row:has-text("Router address") input').first().fill('192.168.9.1');
  await pg.locator('.form-actions button:has-text("Apply")').click();
  const t4 = await lastToast();
  const dialog = await pg.$('.dlg');
  await nav('admin', 'Administration');
  await pg.locator('.form-row:has-text("Router name") input').fill(HN);
  await pg.locator('.panel:has(h2:has-text("General")) button:has-text("Apply")').click();
  await pg.waitForTimeout(2500);
  const after = dx('uci get network.lan.ipaddr; uci get system.@system[0].hostname');
  ok('failed LAN save is discarded, later save applies alone', !dialog && after === lanBefore + '\n' + HN, 'toast "' + t4 + '"; router now: ' + flat(after));

  // 5. USB: no system partitions listed, sharing refuses a non-drive folder
  await nav('usb', 'USB Storage');
  const mounted = (await pg.textContent('.panel:has(h2:has-text("Attached storage")) .sub')).trim();
  const smb = pg.locator('.panel:has(h2:has-text("Network file sharing"))');
  // The seeded router has exactly one drive (/mnt/usb); the container's own
  // sd*/bind mounts must not be listed, and a system folder must be refused.
  let t5 = '(no SMB server installed)';
  if (await smb.locator('input[type="checkbox"]').count()) {
    await smb.locator('input[type="checkbox"]').check({ force: true });
    await smb.locator('input[type="text"]').fill('/overlay');
    await smb.locator('button:has-text("Apply")').click();
    t5 = await lastToast();
  }
  const shares = dx('(uci -q show ksmbd; uci -q show samba4) | grep -c "share$"');
  ok('USB: only the real drive listed, a system folder is refused', mounted.startsWith('1') && shares === '0' && /attached drive/.test(t5), mounted + '; toast "' + t5 + '"; shares=' + shares);

  // 6. DDNS provider name exists on the router
  await nav('ddns', 'Dynamic DNS');
  await pg.click('button:has-text("Add a hostname")');
  await pg.selectOption('select', 'no-ip.com');
  await pg.fill('input[placeholder="myhome.duckdns.org"]', 'myhome.ddns.net');
  await pg.click('button:has-text("Add hostname")');
  await pg.waitForTimeout(2500);
  const svc = dx('uci get ddns.myhome_ddns_net.service_name; ls /usr/share/ddns/default/no-ip.com.json');
  ok('DDNS entry uses a provider the router knows', svc.startsWith('no-ip.com\n/usr'), flat(svc));

  // 7. Doctor still renders; 8. logout after the session died server-side
  await nav('doctor', 'Network Doctor');
  await pg.waitForFunction(() => { const x = document.querySelector('.page-head .btn'); return x && x.textContent.trim() === 'Re-run'; });
  ok('Doctor renders', (await pg.$$('table.clients tbody tr')).length >= 4, (await pg.textContent('.panel-h h2')).trim());
  dx('/etc/init.d/rpcd restart; sleep 2');
  await pg.click('.topbar .tbtn:last-child');
  await pg.waitForTimeout(1500);
  ok('logout works even when the session already expired', !!(await pg.$('input[autocomplete="username"]')));
  ok('no uncaught page errors', errs.length === 0, errs.join('; '));
  await b.close();
  console.log(res.every(Boolean) ? '=== ALL UI CHECKS PASSED ===' : '=== SOME UI CHECKS FAILED ===');
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.log('SCRIPT FAIL', e.message.split('\n')[0]); process.exit(1); });
