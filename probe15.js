"use strict";

/* p15: DOTNET SWAP (fixed setup) — use non-inhouse dotnet-launcher (console app).
   setup via mkdir -p + cp (old Node: no recursive mkdir, no copyFileSync). fs.writeFileSync for manifest. */
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var SDK = '/home/owner/share/tmp/sdk_tools';
var R = { ts: new Date().toISOString(), probe: 'p15', results: {}, log: [] };

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

function manifestXml(type) {
  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<manifest package="com.probe.swap" version="1.0.0" api-version="3.0" xmlns="http://tizen.org/ns/packages">\n' +
    '  <profile name="tv" />\n' +
    '  <ui-application appid="com.probe.swap" exec="swap.dll" multiple="false" nodisplay="false" taskmanage="false" type="' + type + '" launch_mode="single">\n' +
    '    <label>swap</label>\n' +
    '  </ui-application>\n' +
    '</manifest>\n';
}

R.results.live_before = run('md5sum /opt/dbspace/.app-context.db 2>&1', 15000);
run('rm -f /tmp/swap_done.txt /tmp/swap_err.txt 2>&1', 5000);

function live() { return run('md5sum /opt/dbspace/.app-context.db 2>&1', 15000); }
function markers() { return 'done=[' + run('cat /tmp/swap_done.txt 2>&1', 5000) + '] err=[' + run('cat /tmp/swap_err.txt 2>&1', 5000) + ']'; }

// setup A: bin/swap.dll (csfs-style) + type=dotnet
run('mkdir -p ' + SDK + '/swapapp/bin 2>&1', 5000);
R.results.cp_a = run('cp ' + SDK + '/swap3.dll ' + SDK + '/swapapp/bin/swap.dll 2>&1 && echo CP_OK', 5000);
try { fs.writeFileSync(SDK + '/swapapp/tizen-manifest.xml', manifestXml('dotnet')); R.results.write_a = 'ok'; }
catch (e) { R.results.write_a = 'err ' + e; }
R.results.app_a_ls = run('ls -la ' + SDK + '/swapapp/ ' + SDK + '/swapapp/bin/ 2>&1', 10000);

R.results.runA = run('/usr/bin/dotnet-launcher ' + SDK + '/swapapp 2>&1', 30000);
R.results.afterA = markers() + ' live=' + live();
R.results.dotnet_logs = run('ls -t /tmp/dotnet_error.* 2>/dev/null | head -3', 5000);

// setup B: dll in app root (not bin/) + type=dotnet
run('mkdir -p ' + SDK + '/swapapp_root 2>&1', 5000);
R.results.cp_b = run('cp ' + SDK + '/swap4.dll ' + SDK + '/swapapp_root/swap.dll 2>&1 && echo CP_OK', 5000);
try { fs.writeFileSync(SDK + '/swapapp_root/tizen-manifest.xml', manifestXml('dotnet')); R.results.write_b = 'ok'; }
catch (e) { R.results.write_b = 'err ' + e; }
R.results.runB = run('/usr/bin/dotnet-launcher ' + SDK + '/swapapp_root 2>&1', 30000);
R.results.afterB = markers() + ' live=' + live();

// setup C: bin/swap.dll + type=dotnet-inhouse (in case type matters)
run('mkdir -p ' + SDK + '/swapapp_inh/bin 2>&1', 5000);
run('cp ' + SDK + '/swap3.dll ' + SDK + '/swapapp_inh/bin/swap.dll 2>&1', 5000);
try { fs.writeFileSync(SDK + '/swapapp_inh/tizen-manifest.xml', manifestXml('dotnet-inhouse')); R.results.write_c = 'ok'; }
catch (e) { R.results.write_c = 'err ' + e; }
R.results.runC_inhouse = run('/usr/bin/dotnet-launcher-inhouse ' + SDK + '/swapapp_inh 2>&1', 30000);
R.results.afterC = markers() + ' live=' + live();

R.results.final = 'done ' + new Date().toISOString();
postRaw('/p15info', JSON.stringify(R));
L('p15 done');
