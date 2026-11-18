"use strict";
var net = require('net');
var adbhost = require('adbhost');
var HOST='192.168.1.61', PORT=9999;
var R={ts:new Date().toISOString(), probe:'p146', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,500));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},5000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p146info',new Buffer(JSON.stringify(R),'utf8'));}
function main(){
  try {
    var info = tizen.application.getAppInfo('launcherxx.MyLauncher');
    R.results.appInfo = JSON.stringify(info);
  } catch(e) { R.results.appInfo = 'ERR '+String(e); }
  var client = adbhost.createConnection({host:'127.0.0.1', port:26101});
  client._stream.on('connect', function(){
    L('adb connected');
    var shell = client.createStream('shell:0 debug launcherxx.MyLauncher');
    shell.on('data', function(data){
      var s = data.toString();
      L(s.substring(0,500));
      var m = /port:\s*(\d+)/.exec(s);
      if (m) { R.results.port = m[1]; }
    });
    shell.on('error', function(e){ L('shell err '+e); });
    setTimeout(function(){
      R.results.final='done '+new Date().toISOString();
      postFinal();
      try { client._stream.end(); } catch(e) {}
    }, 8000);
  });
  client._stream.on('error', function(e){ L('adb err '+e); R.results.final='adb err'; postFinal(); });
  setTimeout(function(){ postFinal(); }, 20000);
}
try{main();}catch(e){R.results.fatal=String(e)+' | '+(e.stack||'no-stack');postFinal();}
