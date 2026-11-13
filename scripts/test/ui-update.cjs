// usage: node ui-update.cjs <container> <port> <mode>      (update-check.sh does this)
// Drives the "UnTangled updates" panel on the Software screen in a real browser.
//   mode "upgrade": the router runs an OLDER UnTangled and has the feed set up;
//                   clicks Check -> Update now and verifies the router and the
//                   page both end up on the feed's version.
//   mode "nofeed":  no feed configured; verifies the hint and that no update is offered.
//   mode "current": nothing newer in the feed; verifies "up to date".
// env: SCHEME=https to browse over HTTPS (needed when untangled-full is installed,
//      its HTTPS redirect is on); PM=apk on a snapshot router.
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const [, , C, PORT, MODE, OUT] = process.argv; // OUT: optional screenshot directory
const dx = (cmd) => execFileSync('docker', ['exec', C, 'sh', '-c', cmd + '; true']).toString().trim();
const LIST = process.env.PM === 'apk'
  ? 'apk list -I 2>/dev/null | grep "^untangled" | sed -E "s/^(untangled(-full|-mesh)?)-([0-9][^ ]*) .*/\\1 - \\3/" | sort'
  : 'opkg list-installed | grep untangled';
const res = [];
const ok = (name, pass, info = '') => { res.push(!!pass); console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  -- ' + String(info).replace(/\n/g, ' | ') : '')); };

(async () => {
  const b = await chromium.launch();
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true })).newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('dialog', (d) => d.accept());
  await pg.goto((process.env.SCHEME || 'http') + '://127.0.0.1:' + PORT + '/untangled/');
  await pg.fill('input[autocomplete="username"]', 'ut');
  await pg.fill('input[type="password"]', 'test1234');
  await pg.press('input[type="password"]', 'Enter');
  await pg.waitForSelector('.sidebar');
  await pg.evaluate(() => { location.hash = '#software'; });
  const panel = pg.locator('.panel:has(h2:has-text("UnTangled updates"))');
  await panel.waitFor();
  const before = dx(LIST);
  const FROM = (before.split('\n').find((l) => l.startsWith('untangled - ')) || '').slice('untangled - '.length);
  ok('update panel is shown, nothing contacted yet', /Check for updates/.test(await panel.textContent()));

  await panel.locator('button:has-text("Check for updates")').click();
  await pg.waitForFunction(() => !/Checking…/.test(document.querySelector('.panel:has(h2)')?.parentElement.textContent || ''), null, { timeout: 60000 });
  await pg.waitForTimeout(500);
  const txt = (await panel.textContent()).replace(/\s+/g, ' ');
  if (OUT) await pg.screenshot({ path: OUT + '/update-' + MODE + '-checked.png' });

  if (MODE === 'nofeed') {
    ok('no feed: explains the feed is not set up, offers no update', /feed is not set up/.test(txt) && !/Update now/.test(txt), txt.slice(0, 150));
  } else if (MODE === 'current') {
    ok('current: says up to date, offers no update', /up to date/.test(txt) && !/Update now/.test(txt), txt.slice(0, 150));
  } else {
    ok('offers the newer version, listing only installed packages', /is available/.test(txt) && /Update now/.test(txt) && new RegExp('untangled ' + FROM.replace(/[.]/g, '[.]') + ' → ').test(txt), txt.slice(0, 220));
    const offersFull = /untangled-full/.test(txt), hasFull = /untangled-full/.test(before);
    ok('does not offer a package that is not installed', offersFull === hasFull, 'offered full=' + offersFull + ', installed full=' + hasFull);
    const want = (txt.match(/untangled \S+ → (\S+)/) || [])[1];
    await panel.locator('button:has-text("Update now")').click();
    await pg.waitForTimeout(1200);
    if (OUT) await pg.screenshot({ path: OUT + '/update-progress.png' });
    // The page reloads itself when done, under a fresh ?updated=<ts> URL. (Do not
    // watch for a new script name: an old test build of the same code has the same one.)
    await pg.waitForURL(/[?&]updated=\d+/, { timeout: 120000 });
    await pg.waitForSelector('.sidebar', { timeout: 30000 });
    const after = dx(LIST);
    ok('router is on the new version for every installed package', after.split('\n').every((l) => l.endsWith(want)) && after.split('\n').length === before.split('\n').length, before + '  =>  ' + after);
    ok('page reloaded onto the new build and is still signed in', !!(await pg.$('.sidebar')) && !(await pg.$('input[type="password"]')), (await pg.textContent('.topbar .model')).replace(/\s+/g, ' ').trim());
    if (process.env.PM !== 'apk') ok('package state is clean (installed, not half-configured)', !/half|unpacked/.test(dx('opkg status untangled | grep Status')) && dx('ls /var/lock/opkg.lock 2>/dev/null') === '', dx('opkg status untangled | grep Status'));
    else ok('apk database is consistent', /OK/.test(dx('apk audit --check-permissions >/dev/null 2>&1; apk fix --simulate 2>&1 | tail -1')), dx('apk fix --simulate 2>&1 | tail -1'));
    if (OUT) await pg.screenshot({ path: OUT + '/update-after.png' });
  }
  ok('no uncaught page errors', errs.length === 0, errs.join('; '));
  await b.close();
  console.log(res.every(Boolean) ? '=== ALL UPDATE CHECKS PASSED (' + MODE + ') ===' : '=== SOME UPDATE CHECKS FAILED (' + MODE + ') ===');
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.log('SCRIPT FAIL', e.message.split('\n')[0]); process.exit(1); });
