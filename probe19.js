"use strict";
/* p19: dotnet-launcher deep dive — why silent exit 1, how to run our swap.dll as root */
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
var HOST = '192.168.1.62';
var PORT = 9999;
var SDK = '/home/owner/share/tmp/sdk_tools';
var APP = SDK + '/swapapp';
var R = { ts: new Date().toISOString(), probe: 'p19', results: {}, log: [] };
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

// 0. ensure our app dir is set up (from p15/p17)
run('mkdir -p ' + APP + '/bin 2>&1', 5000);
run('cp ' + SDK + '/swap3.dll ' + APP + '/bin/swap.dll 2>&1', 5000);
try { fs.writeFileSync(APP + '/tizen-manifest.xml', '<?xml version="1.0" encoding="utf-8"?>\n<manifest package="com.probe.swap" version="1.0.0" api-version="3.0" xmlns="http://tizen.org/ns/packages"><profile name="tv" /><ui-application appid="com.probe.swap" exec="swap.dll" multiple="false" nodisplay="false" taskmanage="false" type="dotnet" launch_mode="single"><label>swap</label></ui-application></manifest>'); } catch(e){ R.write='err '+e; }

// 1. tools available on TV
R.results.tools = run('which strings od hexdump xxd objdump readelf 2>&1; echo ---; ls -la /usr/bin/strings /usr/bin/od 2>&1', 15000);

// 2. dotnet-launcher size + type
R.results.dnet_info = run('ls -la /usr/bin/dotnet-launcher /usr/bin/dotnet-launcher-inhouse 2>&1; echo ---FILE---; file /usr/bin/dotnet-launcher 2>&1', 15000);

// 3. dotnet-run-ni.sh (how dotnet is invoked by system)
R.results.dotnet_run_ni = run('cat /usr/bin/dotnet-run-ni.sh 2>&1', 15000);

// 4. dotnet-launcher strings (key phrases) — try strings, fallback to grep on raw
R.results.dnet_strings = run('(strings /usr/bin/dotnet-launcher 2>/dev/null || cat /usr/bin/dotnet-launcher) | grep -aE "root path|AUL_|manifest|corerun|\\.dll|app.?path|register|signature|verif|Cannot|cannot|Failed|failed|Error|error|usage|Usage|NULL|not found|No such" | head -80', 25000);

// 5. Test dotnet-launcher on REGISTERED .NET apps
R.results.dnet_mycontents = run('/usr/bin/dotnet-launcher /usr/apps/com.samsung.tv.mycontents 2>&1; echo EXIT=$?', 30000);
R.results.dnet_csfs = run('/usr/bin/dotnet-launcher /usr/apps/com.samsung.tv.csfs 2>&1; echo EXIT=$?', 30000);

// 6. Test our app with REGISTERED appid in AUL (in case it cross-checks)
R.results.dnet_reg_aid = run('AUL_APP_ROOT=' + APP + ' AUL_APPID=com.samsung.tv.mycontents AUL_PKGID=com.samsung.tv.mycontents /usr/bin/dotnet-launcher ' + APP + ' 2>&1; echo EXIT=$?', 30000);

// 7. Test our app, dll directly as argv (no dir)
R.results.dnet_dll_arg = run('/usr/bin/dotnet-launcher ' + APP + '/bin/swap.dll 2>&1; echo EXIT=$?', 30000);

// 8. wasutility deeper
R.results.wasutility = run('wasutility 2>&1 | head -40; echo ---HELP---; wasutility --help 2>&1 | head -20; echo ---H---; wasutility -h 2>&1 | head -20', 25000);

// 9. census: which .NET apps registered (manifest exec/type)
R.results.dotnet_apps = run('for d in /usr/apps/com.samsung.tv.* /usr/apps/org.tizen.*; do m="$d/tizen-manifest.xml"; if [ -f "$m" ]; then t=$(grep -aoE "type=\\"dotnet[^\\"]*\\"" "$m" 2>/dev/null | head -1); if [ -n "$t" ]; then ex=$(grep -aoE "exec=\\"[^\\"]*\\"" "$m" 2>/dev/null | head -1); aid=$(grep -aoE "appid=\\"[^\\"]*\\"" "$m" 2>/dev/null | head -1); echo "$d : $aid : $ex : $t"; fi; fi; done 2>&1 | head -40', 40000);

// 10. /usr/apps top-level (what's installed)
R.results.usr_apps = run('ls /usr/apps/ 2>&1 | head -80', 15000);

// 11. live db state (baseline)
R.results.live = run('md5sum /opt/dbspace/.app-context.db 2>&1', 10000);

R.results.final = 'done ' + new Date().toISOString();
postRaw('/p19info', JSON.stringify(R));
L('p19 done');
