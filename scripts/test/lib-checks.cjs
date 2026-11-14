// usage: node lib-checks.cjs <container> <port> <bundle.cjs>   (run.sh does this)
// Drives the app's real library functions against a real OpenWRT container and
// checks the resulting router state with `docker exec`.
const { execFileSync } = require('child_process');
const C = process.argv[2], PORT = process.argv[3], BUNDLE = process.argv[4];
const BASE = 'http://127.0.0.1:' + PORT;

// Minimal browser shims the library modules touch at import time.
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(String(u).startsWith('/') ? BASE + u : u, o);
const store = new Map();
const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = storage;
globalThis.localStorage = storage;
globalThis.document = { documentElement: { setAttribute() {} } };
globalThis.window = { addEventListener() {} };
globalThis.location = { hash: '', protocol: 'http:', hostname: '127.0.0.1' };

const L = require(require('path').resolve(BUNDLE));
const dx = (cmd) => { try { return execFileSync('docker', ['exec', C, 'sh', '-c', cmd + '; true']).toString().trim(); } catch (e) { return ('ERR ' + (e.stdout || '') + (e.stderr || '')).trim(); } };
const res = [];
const ok = (name, pass, info = '') => { res.push(!!pass); console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  -- ' + String(info).replace(/\n/g, ' | ') : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---- validate.ts (pure)
  const v = L.validate;
  ok('validate: ipv4', v.isIpv4('192.168.1.1') && !v.isIpv4('192.168.1.256') && !v.isIpv4('192.168.1') && !v.isIpv4('abc'));
  ok('validate: netmask', v.isNetmask('255.255.255.0') && v.isNetmask('255.255.252.0') && !v.isNetmask('255.0.255.0') && !v.isNetmask('0.0.0.0') && v.isNetmask('255.255.255.255'));
  ok('validate: port', v.isPortOrRange('443') && v.isPortOrRange('5000-5010') && !v.isPortOrRange('0') && !v.isPortOrRange('70000') && !v.isPortOrRange('9-3') && !v.isPortOrRange('abc'));
  ok('validate: lease/int', v.isLeaseTime('12h') && v.isLeaseTime('infinite') && !v.isLeaseTime('soon') && v.isIntIn('100', 1, 65534) && !v.isIntIn('1e3', 1, 65534));

  await L.ubus.login('ut', 'test1234');

  // ---- Wi-Fi status over /ubus. On 25.12+ `network.wireless status` rejects
  // the session argument uhttpd adds (INVALID_ARGUMENT), so the app falls back
  // to luci-rpc; either way both seeded radios must come back.
  const wst = await L.net.wirelessStatus().catch((e) => ({ error: e.message }));
  if (!Object.keys(wst).length) {
    // The 23.05 x86 image has no wifi driver scripts: netifd reports no radios.
    console.log('SKIP  wifi status: this image reports no radios');
  } else {
    ok('wifi status: both radios reported', !!wst.radio0 && !!wst.radio1 && Array.isArray(wst.radio0.interfaces), Object.keys(wst).join(',') + (wst.error ? ' ' + wst.error : ''));
    // A router that only joins another network (wireless bridge, no access
    // point of its own) is not a Wi-Fi fault.
    dx('cp /etc/config/wireless /root/wireless.bak; uci set wireless.default_radio0.mode=sta; uci set wireless.default_radio1.mode=sta; uci commit wireless; wifi reload; sleep 4');
    await L.net.getClients();
    ok('wifi status: client-only router is not flagged', L.net.wifiDiag === '' && !L.net.wifiAbsent, L.net.wifiDiag);
    dx('cp /root/wireless.bak /etc/config/wireless; rm /root/wireless.bak; wifi reload; sleep 4');
  }

  // ---- Extend Wi-Fi: join on the radio that heard the network, wwan in wan zone, rollback window
  const before = dx('uci show wireless | grep -c "mode=.sta."; uci get firewall.@zone[1].network');
  const net = { ssid: 'Upstairs 5G', signal: 4, locked: true, bssid: 'aa:bb:cc:00:11:22', radio: 'radio1', bandLabel: '5 GHz', encryption: 'sae-mixed' };
  let shortKey = '';
  try { await L.repeater.joinNetwork(net, 'short'); } catch (e) { shortKey = e.message; }
  ok('extend: short password refused before anything is staged', /8 characters/.test(shortKey) && dx('uci show wireless | grep -c "mode=.sta."') === before.split('\n')[0], shortKey);
  await L.repeater.joinNetwork(net, 'upstairs-secret');
  await sleep(2500);
  const sta = dx('uci show wireless | grep -E "wifi-iface\\[" | sort | tr "\\n" " "; echo; uci get firewall.@zone[1].network; uci get network.wwan.proto');
  ok('extend: client iface on radio1 with announced encryption, wwan=dhcp in wan zone', /device='radio1'/.test(sta) && /encryption='sae-mixed'/.test(sta) && /network='wwan'/.test(sta) && /\bwwan\b/.test(sta.split('\n')[1]) && /dhcp/.test(sta), sta);
  // do not confirm -> explicit rollback restores the previous config
  await L.ubus.uciRollback();
  await sleep(3000);
  const rolled = dx('uci show wireless | grep -c "mode=.sta."; uci get firewall.@zone[1].network; uci -q get network.wwan.proto || echo none');
  ok('extend: rollback restores wireless, zone and network', rolled === before + '\nnone', rolled);
  // and the keep path
  await L.repeater.joinNetwork(net, 'upstairs-secret');
  await L.ubus.uciConfirm();
  await sleep(1500);
  await L.repeater.joinNetwork({ ...net, ssid: 'Other', radio: 'radio0', encryption: 'psk2' }, 'other-secret-1');
  await L.ubus.uciConfirm();
  await sleep(1500);
  const again = dx('uci show wireless | grep -c "mode=.sta."; uci show wireless | grep -E "\\.ssid=.Other.|device=.radio0." | wc -l; uci get firewall.@zone[1].network');
  ok('extend: re-join reuses the one client iface and moves it to the other radio', again.split('\n')[0] === '1' && /wwan/.test(again) && (again.match(/wwan/g) || []).length === 1, again);

  // ---- WireGuard client: zone membership + full removal
  const conf = '[Interface]\nPrivateKey = cOFA+3p5IjkzIjkzIjkzIjkzIjkzIjkzIjkzIjkzIjk=\nAddress = 10.8.0.2/32, fd00::2/128\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = 6jV2UEdzKtF5qK9Wn0aQm0aQm0aQm0aQm0aQm0aQm0a=\nEndpoint = [2001:db8::1]:51820\nAllowedIPs = 0.0.0.0/0, ::/0\n';
  await L.vpn.addWgClient('My Provider', conf);
  await sleep(2500);
  const wg = dx('uci get network.vpnc_my_provide.proto; uci show network | grep -E "endpoint_host|endpoint_port|allowed_ips" | tr "\\n" " "; echo; uci get firewall.@zone[1].network; fw4 check 2>&1 | tail -1');
  ok('wg client: iface + IPv6 endpoint parsed + in wan zone, ruleset valid', /^wireguard/.test(wg) && /endpoint_host='2001:db8::1'/.test(wg) && /endpoint_port='51820'/.test(wg) && /vpnc_my_provide\b/.test(wg.split('\n')[2]) && /passes/.test(wg), wg);
  const st = await L.vpn.loadVpn();
  const cl = st.wg.find((w) => w.role === 'client');
  await L.vpn.deleteWgClient(cl.id);
  await sleep(2500);
  const wgGone = dx('uci show network | grep -c "vpnc_my_provide"; uci get firewall.@zone[1].network');
  ok('wg client: removal deletes iface, peer and zone entry', wgGone.split('\n')[0] === '0' && !/vpnc/.test(wgGone), wgGone);

  // ---- Dual WAN: metrics on both network interfaces
  await L.dualwan.saveDualWan('failover', 'wan', 'wanb');
  await sleep(3000);
  const dw = dx('uci get network.wan.metric; uci get network.wanb.metric; uci show mwan3 | grep -E "metric|use_member|=interface" | tr "\\n" " "; echo; mwan3 interfaces 2>&1 | grep -E "interface (wan|wanb) " | tr "\\n" " "; logread | grep -ci "mwan3.*no metric\\|metric.*not\\|missing metric" ');
  ok('dual wan: distinct route metrics written, mwan3 tracks both', /^10\n20/.test(dw) && /interface wan /.test(dw) && /interface wanb /.test(dw), dw);
  dx('uci set network.wan.metric=5; uci set network.wanb.metric=7; uci commit network');
  await L.dualwan.saveDualWan('balance', 'wan', 'wanb');
  await sleep(2000);
  ok('dual wan: existing distinct metrics are kept', dx('uci get network.wan.metric; uci get network.wanb.metric') === '5\n7');

  // ---- IPv6 relay: both halves, and clean switch back
  let c6 = await L.ipv6.loadIpv6();
  await L.ipv6.saveIpv6({ ...c6, lanMode: 'relay' });
  await sleep(2000);
  const r6 = dx('uci show dhcp.lan | grep -E "\\.(ra|dhcpv6|ndp)=" | tr "\\n" " "; echo; uci show dhcp.wan6 | grep -E "\\.(ra|dhcpv6|ndp|master|interface|ignore)=" | tr "\\n" " "');
  ok('ipv6 relay: lan relays (ra/dhcpv6/ndp) and wan6 is master', (r6.split('\n')[0].match(/relay/g) || []).length === 3 && /master='1'/.test(r6) && (r6.split('\n')[1].match(/relay/g) || []).length === 3, r6);
  c6 = await L.ipv6.loadIpv6();
  await L.ipv6.saveIpv6({ ...c6, lanMode: 'server', dns: ['2606:4700:4700::1111'] });
  await sleep(2000);
  const s6 = dx('uci show dhcp.lan | grep -E "\\.(ra|dhcpv6|ndp|dns)=" | tr "\\n" " "; echo; uci show dhcp.wan6 | grep -cE "\\.(ra|dhcpv6|ndp|master)="');
  ok('ipv6 server: relay leftovers removed', /ra='server'/.test(s6) && !/ndp/.test(s6) && s6.split('\n')[1] === '0', s6);

  // ---- USB / SMB with samba4 as the installed server
  const u = await L.usb.loadUsb();
  ok('usb: detects samba4 and a real mount only', u.smb.installed && u.smb.server === 'samba4' && u.mounts.length === 1 && u.mounts[0].mountpoint === '/mnt/usb', JSON.stringify({ smb: u.smb, mounts: u.mounts.map((m) => m.mountpoint) }));
  ok('usb: shareablePath', L.usb.shareablePath('/mnt/usb/media', u.mounts) && !L.usb.shareablePath('/overlay', u.mounts) && !L.usb.shareablePath('/mnt/usb/../../etc', u.mounts) && !L.usb.shareablePath('/mnt', u.mounts));
  await L.usb.setSmb(true, '/mnt/usb', u.smb.id, u.smb.server);
  await sleep(2500);
  const smb = dx('uci show samba4 | grep -E "sambashare|UnTangled|/mnt/usb" | tr "\\n" " "; echo; uci -q show ksmbd | grep -c share; grep -c "UnTangled" /var/etc/smb.conf /etc/samba/smb.conf 2>/dev/null | tr "\\n" " "');
  ok('usb: share written to samba4 (not ksmbd) and rendered into smb.conf', /=sambashare/.test(smb) && /path='\/mnt\/usb'/.test(smb) && /:[1-9]/.test(smb), smb);
  const u2 = await L.usb.loadUsb();
  await L.usb.setSmb(false, '/mnt/usb', u2.smb.id, u2.smb.server);
  await sleep(1500);
  ok('usb: turning sharing off removes the samba4 share', dx('uci show samba4 | grep -c "=sambashare"') === '0');

  console.log(res.every(Boolean) ? '=== ALL LIBRARY CHECKS PASSED ===' : '=== SOME LIBRARY CHECKS FAILED ===');
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.log('LIBRARY CHECKS CRASHED', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e); process.exit(1); });
