"use strict";

/* p11: state probe — journal/live state after fwrite test */
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p11', results: {}, log: [] };

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

R.results.jrn_md5 = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 15000);
R.results.jrn_stat = run('stat /opt/dbspace/.app-context.db-journal 2>&1', 10000);
R.results.jrn_head = run('head -c 32 /opt/dbspace/.app-context.db-journal 2>&1 | od -A x -t x1z | head -4', 10000);
R.results.live_md5 = run('md5sum /opt/dbspace/.app-context.db 2>&1', 15000);
R.results.sdktools = run('ls -la /home/owner/share/tmp/sdk_tools/appctx_hot_journal 2>&1', 10000);
R.results.final = 'done ' + new Date().toISOString();
postRaw('/p11info', JSON.stringify(R));
L('p11 done');
