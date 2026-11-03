"use strict";
/* p33: TizenBrew module — forensics post-install + stato /opt/dbspace
   - identity (date, id)
   - /opt/dbspace: ls, md5+size journal e DB live (via crypto)
   - exfil raw: DB live (/appctx_now.bin), journal (/journal_now.bin), WAS DB (/wasdb.bin)
   - WAS logs: /var/log ls, file recenti, grep 118022/118012/ProbeAppio/FreshAppio + tail
   - WAS DB: find + stat + exfil
   - residui apps_rw, string "install failed" nei binari, lib was
   - exfil to Mac 192.168.1.62:9999 (/p33info)
*/
var fs = null, cp = null, net = null, crypto = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
try { crypto = require('crypto'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p33', results: {}, log: [] };
var posted = false;

function L(s) { R.log.push(String(s).substring(0, 500)); }

function run(cmd, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  return new Promise(function (resolve) {
    if (!cp) { resolve('[no child_process]'); return; }
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

function md5File(p) {
  try {
    var b = fs.readFileSync(p);
    return { ok: true, md5: crypto.createHash('md5').update(b).digest('hex'), size: b.length };
  } catch (e) { return { ok: false, err: String(e) }; }
}

function postFinal() {
  if (posted) return;
  posted = true;
  R.results.final_ts = new Date().toISOString();
  var text = JSON.stringify(R);
  postBuf('/p33info', new Buffer(text, 'utf8'));
  L('final posted ' + text.length + 'B');
}

function seq(tasks) {
  var i = 0;
  function next() {
    if (i >= tasks.length) { postFinal(); return; }
    var t = tasks[i++];
    t.fn().then(function (r) {
      R.results[t.name] = r;
      next();
    }).catch(function (e) {
      R.results[t.name] = '[exception ' + e + ']';
      next();
    });
  }
  next();
}

var JPATH = '/opt/dbspace/.app-context.db-journal';
var LPATH = '/opt/dbspace/.app-context.db';

var tasks = [
  { name: 'identity', fn: function () { return run('date; date -u; id; hostname 2>/dev/null', 10000); } },
  { name: 'dbspace_ls', fn: function () { return run('ls -la /opt/dbspace/ 2>&1 | head -25', 10000); } },
  { name: 'journal_state', fn: function () {
      var r = md5File(JPATH);
      try { postBuf('/journal_now.bin', fs.readFileSync(JPATH)); L('journal exfil'); } catch (e) {}
      return Promise.resolve(JSON.stringify(r));
  }},
  { name: 'live_state', fn: function () {
      var r = md5File(LPATH);
      try { postBuf('/appctx_now.bin', fs.readFileSync(LPATH)); L('live db exfil'); } catch (e) {}
      return Promise.resolve(JSON.stringify(r));
  }},
  { name: 'varlog_ls', fn: function () { return run('ls -la /var/log/ 2>&1 | head -50', 10000); } },
  { name: 'recent_logs', fn: function () { return run('find /var/log -type f -mmin -2400 2>/dev/null | head -50', 15000); } },
  { name: 'grep_118022', fn: function () { return run('grep -rl 118022 /var/log 2>/dev/null | head -10', 15000); } },
  { name: 'grep_118012', fn: function () { return run('grep -rl 118012 /var/log 2>/dev/null | head -10', 15000); } },
  { name: 'grep_appids', fn: function () { return run('grep -rl "ProbeAppio\\|FreshAppio" /var/log 2>/dev/null | head -10', 15000); } },
  { name: 'tail_appid_logs', fn: function () {
      var files = [];
      var g = String(R.results.grep_appids || '').split('\n');
      for (var i = 0; i < g.length && files.length < 3; i++) {
        var f = g[i].trim();
        if (f && f.indexOf('/') === 0) files.push(f);
      }
      if (!files.length) return Promise.resolve('no hit files');
      var cmd = 'head -c 200 ' + files.join(' ') + ' 2>/dev/null; echo ===; for f in ' + files.join(' ') + '; do echo "--- $f"; tail -60 "$f" 2>/dev/null; done';
      return run(cmd, 15000);
  }},
  { name: 'wasdb_find', fn: function () { return run('find /opt /var /home /etc -xdev \\( -name "*webappservice*" -o -name "*wasdb*" \\) 2>/dev/null | head -20', 25000); } },
  { name: 'wasdb_stat_exfil', fn: function () {
      var files = [];
      var g = String(R.results.wasdb_find || '').split('\n');
      for (var i = 0; i < g.length && files.length < 5; i++) {
        var f = g[i].trim();
        if (f && f.indexOf('/') === 0) files.push(f);
      }
      if (!files.length) return Promise.resolve('no was db found');
      var out = 'ls -la ' + files.join(' ') + ' 2>&1; echo ===';
      return run(out, 10000).then(function (ls) {
        try {
          var b = fs.readFileSync(files[0]);
          if (b.length <= 2000000) { postBuf('/wasdb.bin', b); L('wasdb exfil ' + b.length + 'B'); }
        } catch (e) { R.results.wasdb_exfil_err = String(e); }
        return ls;
      });
  }},
  { name: 'apps_rw', fn: function () { return run('ls -la /opt/usr/home/owner/apps_rw/ 2>/dev/null | head -40', 10000); } },
  { name: 'install_failed_str', fn: function () { return run('grep -rl "install failed" /usr/lib /usr/bin /usr/sbin 2>/dev/null | head -10', 25000); } },
  { name: 'was_libs', fn: function () { return run('ls /usr/lib 2>/dev/null | grep -i -E "was|webapp" | head -20; echo ---; ls -la /usr/lib/webappservice 2>/dev/null | head -25', 10000); } },
  { name: 'was_execute_str', fn: function () { return run('grep -rl "spend time for wascmd" /usr/lib /usr/bin /usr/sbin /opt 2>/dev/null | head -10', 25000); } }
];

seq(tasks);

setTimeout(function () {
  R.results.guard = 'global timeout';
  postFinal();
}, 150000);
