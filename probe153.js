"use strict";
var net = require('net');
var HOST='192.168.1.61', PORT=9999;
var R={ts:new Date().toISOString(), probe:'p153', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,500));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},5000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p153info',Buffer.from(JSON.stringify(R),'utf8'));}
R.results.ok='p153 page loaded';
postFinal();
setTimeout(postFinal,20000);
