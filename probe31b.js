"use strict";
/* p31b: LEAN rerun — small outputs, deterministic caps, heartbeats per step */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p31b', step: 0, results: {}, log: [] };
function L(s){ R.log.push(String(s).substring(0,500)); }
function postRaw(path, text){
  var buf = new Buffer(text,'utf8');
  var hdr = 'POST '+path+' HTTP/1.1\r\nHost: '+HOST+':9999\r\nContent-Type: text/plain\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';
  try { var s=net.connect(PORT,Host_safe()); s.on('connect',function(){ s.write(hdr); var off=0,iv=setInterval(function(){ if(off>=buf.length){clearInterval(iv);setTimeout(function(){s.destroy();},3000);return;} s.write(buf.slice(off,off+4096)); off+=4096;},100); setTimeout(function(){s.destroy();},120000);}); s.on('error',function(e){L('post err '+e.message);}); } catch(e){ L('post ctor '+e); }
}
function Host_safe(){ return '192.168.1.62'; }
var _seq = 0;
var _lastHb = 0;
function STEP(n, label){
  R.step = n;
  R.results['step_'+n] = label + ' @ ' + new Date().toISOString().substring(11,19);
  var now = Date.now();
  if (now - _lastHb > 15000) { _lastHb = now; postRaw('/p31bhb', JSON.stringify({t:now, step:n, label:label})); }
}
function run(cmd, timeoutMs){
  var tsec = Math.max(1, Math.ceil((timeoutMs || 30000)/1000));
  _seq++;
  var tmpout = '/tmp/.t31b_' + _seq;
  // deterministic cap: bg + sleep + kill, output to FILE (never the execSync pipe)
  var wrapped = '( sh -c ' + JSON.stringify(cmd) + ' >' + tmpout + ' 2>&1 & CP=$!; ( sleep ' + tsec + '; kill -9 $CP 2>/dev/null; pkill -9 -P $CP 2>/dev/null ) & W=$!; wait $CP; RC=$?; kill $W 2>/dev/null; cat ' + tmpout + ' 2>/dev/null | head -c 4000; rm -f ' + tmpout + '; exit $RC )';
  try { return cp.execSync(wrapped, {maxBuffer:8*1024*1024}).toString().trim(); }
  catch(e){ var o=''; if(e.stdout)o+=e.stdout.toString(); if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();
    return '[exit '+(e.status!=null?e.status:'?')+'] '+(o||(e&&e.message)||'unknown').substring(0,2000); }
}
function finish(){
  if (R.results.final) return;
  R.results.final = 'done ' + new Date().toISOString();
  try { postRaw('/p31binfo', JSON.stringify(R)); } catch(e){}
  L('p31b done');
}

// 1. state re-verify (did the TV reboot? DBs intact?)
STEP(1, 'state');
R.results.live_md5 = run('md5sum /opt/dbspace/.app-context.db 2>&1', 8000);
R.results.journal_md5 = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 8000);
R.results.dbspace = run('ls -la /opt/dbspace/ 2>&1 | head -15', 8000);
R.results.boot_marker = run('ls -la /run/.wm_ready /tmp/context-mgr_ready 2>&1; echo ---; ps -ef 2>/dev/null | grep -iE "tvctx-manager|app-context" | grep -v grep | head -5', 10000);

// 2. sanity: wrapper works
STEP(2, 'sanity');
R.results.sanity = run('echo sanity-ok', 8000);

// 3. DBus (capped hard — p30/p31 died here or lost the plot)
STEP(3, 'dbus');
R.results.dbus_names = run('dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>&1 | head -60', 12000);
R.results.dbus_acm_introspect = run('dbus-send --system --print-reply --dest=org.tizen.tv.appfw.appctxmgr /org/tizen/tv/appfw/appctxmgr org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -20', 12000);

// 4. systemd service def
STEP(4, 'acm_service');
R.results.acm_service = run('cat /usr/lib/systemd/system/app-context-manager.service 2>&1', 8000);

// 5. find '0' (targeted, NOT full fs)
STEP(5, 'find0');
R.results.find_0 = run("find /usr/bin /usr/sbin /bin /sbin /opt/usr/bin /usr/local/bin -maxdepth 2 -name '0' 2>/dev/null | head; echo ---; ls -la /usr/bin/0 /bin/0 2>&1 | head -5", 15000);
R.results.sdbd = run('cat /etc/init.d/sdbd 2>&1', 8000);

// 6. pkg_initdb location
STEP(6, 'pkg_initdb');
R.results.find_pkg_initdb = run("ls -la /usr/bin/pkg_initdb /bin/pkg_initdb /usr/local/bin/pkg_initdb 2>&1; echo ---; find /usr -maxdepth 3 -name '*pkg_init*' 2>/dev/null | head -5", 20000);

// 7. FreeMyTV layout
STEP(7, 'fmtv');
R.results.fmtv_ls = run('ls -la /opt/usr/apps/FreeMyTVio/ 2>&1 | head -20', 8000);
R.results.fmtv_files = run('find /opt/usr/apps/FreeMyTVio -maxdepth 3 -type f 2>/dev/null | head -20', 15000);

// 8. /run + cynara
STEP(8, 'run_cynara');
R.results.run_ls = run('ls -la /run/ 2>&1 | head -25', 8000);
R.results.cynara = run("find /run /var/run -maxdepth 3 -iname '*cynara*' 2>/dev/null | head -10; echo ---; ls -la /opt/usr/data/cynara 2>&1 | head -10", 20000);

// 9. processes of interest
STEP(9, 'ps');
R.results.ps_ctx = run("ps -ef 2>/dev/null | grep -iE 'tvctx|context|dbus|cynara|sdbd|FreeMyTV|launchpad' | grep -v grep | head -15", 10000);

// 10. pkgmgr parserlib
STEP(10, 'pkgmgr');
R.results.pkgmgr_parserlib = run('ls -la /etc/package-manager/parserlib/ 2>&1 | head -15', 8000);

finish();
L('p31b done');
