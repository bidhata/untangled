// usage: node ui-validation.cjs <container> <port>   (run.sh does this)
// Form validation + the Extend Wi-Fi screen, driven in the real UI.
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const C = process.argv[2], PORT = process.argv[3];
const dx = (cmd) => execFileSync('docker', ['exec', C, 'sh', '-c', cmd + '; true']).toString().trim();
const res = [];
const ok = (name, pass, info = '') => { res.push(!!pass); console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  -- ' + String(info).replace(/\n/g, ' | ') : '')); };

(async () => {
  const b = await chromium.launch();
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => {
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent.trim());
      }))).observe(document.body, { childList: true, subtree: true });
    });
  });
  const lastToast = async () => { await pg.waitForTimeout(800); return pg.evaluate(() => window.__toasts[window.__toasts.length - 1] || ''); };
  const nav = async (id, h1) => { await pg.evaluate((i) => { location.hash = '#' + i; }, id); await pg.waitForSelector('h1:has-text("' + h1 + '")'); await pg.waitForTimeout(900); };

  await pg.goto('http://127.0.0.1:' + PORT + '/untangled/');
  await pg.fill('input[autocomplete="username"]', 'ut');
  await pg.fill('input[type="password"]', 'test1234');
  await pg.keyboard.press('Enter');
  await pg.waitForSelector('.sidebar');

  // LAN: bad address and bad mask are refused, nothing reaches the router
  await nav('lan', 'LAN');
  // 23.05/24.10 store ipaddr + netmask, 25.12+ a single 'ip/prefix' list entry.
  const lanCfg = () => dx('uci -q get network.lan.ipaddr; uci -q get network.lan.netmask');
  const lanBefore = lanCfg();
  const lanIp = pg.locator('.form-row:has-text("Router address") input').first();
  await lanIp.fill('192.168.1.999');
  await pg.locator('.form-actions button:has-text("Apply")').click();
  const t1 = await lastToast();
  await lanIp.fill('192.168.1.1');
  const mask = pg.locator('.form-row:has-text("ubnet") input').first();
  await mask.fill('255.0.255.0');
  await pg.locator('.form-actions button:has-text("Apply")').click();
  const t2 = await lastToast();
  ok('LAN refuses a bad address and a bad mask', /router address/.test(t1) && /subnet mask/.test(t2) && !(await pg.$('.dlg')) && lanCfg() === lanBefore, t1 + ' / ' + t2);

  // WAN: static without a gateway
  await nav('wan', 'Internet');
  const gwBefore = dx('uci get network.wan.gateway');
  await pg.locator('.form-row:has(.lbl:text-matches("^Gateway")) input').first().fill('not-a-gateway');
  await pg.locator('.form-actions button:has-text("Apply")').click();
  const t3 = await lastToast();
  ok('WAN refuses an incomplete static setup', /valid (IP address|gateway|subnet)/.test(t3) && !(await pg.$('.dlg')) && dx('uci get network.wan.gateway') === gwBefore, t3);

  // Port forwarding: bad port, then a good rule lands in the firewall
  await nav('portfwd', 'Open access to a device');
  await pg.click('button:has-text("+ Open access")');
  await pg.waitForTimeout(400);
  await pg.click('button.btn:text-is("Custom")');
  const inputs = pg.locator('.panel input[type="text"]');
  const n = await inputs.count();
  // fill by placeholder/label heuristics: find the port and device-address inputs
  const portIn = pg.locator('.form-row:has(.lbl:text-matches("^Port")) input[type="text"]').first();
  const ipIn = pg.locator('input[placeholder="192.168.1.x"]');
  await portIn.fill('99999');
  if (await ipIn.count()) await ipIn.fill('192.168.1.50');
  await pg.locator('.form-actions button:has-text("Open access")').click();
  const t4 = await lastToast();
  await portIn.fill('8443');
  await pg.locator('.form-actions button:has-text("Open access")').click();
  await pg.waitForTimeout(3000);
  const fw = dx('uci show firewall | grep -E "src_dport|dest_ip" | tr "\\n" " "; fw4 print 2>/dev/null | grep -c "dport 8443"');
  ok('Port forwarding refuses port 99999, accepts 8443', /1 to 65535/.test(t4) && /src_dport='8443'/.test(fw) && !/99999/.test(fw), t4 + ' / ' + fw + ' (inputs ' + n + ')');

  // Extend Wi-Fi: screen loads and reports the scan failure cleanly on a radio-less box
  await nav('extend', 'Extend Wi-Fi');
  await pg.click('button:has-text("Scan")');
  await pg.waitForTimeout(4000);
  const scanMsg = (await pg.textContent('.panel')).replace(/\s+/g, ' ');
  ok('Extend Wi-Fi: scan failure is shown, no crash', /Could not scan|No networks found/.test(scanMsg), scanMsg.slice(0, 160));

  ok('no uncaught page errors', errs.length === 0, errs.join('; '));
  await b.close();
  console.log(res.every(Boolean) ? '=== ALL VALIDATION CHECKS PASSED ===' : '=== SOME VALIDATION CHECKS FAILED ===');
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.log('SCRIPT FAIL', e.message.split('\n')[0]); process.exit(1); });
