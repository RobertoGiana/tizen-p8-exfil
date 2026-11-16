"use strict";
var net = require('net');
var HOST = '192.168.1.61';
var PORT = 9999;
var body = new Buffer('p80 hello ' + new Date().toISOString(), 'utf8');
var hdr = 'POST /p80hello HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: text/plain\r\nContent-Length: ' + body.length + '\r\nConnection: close\r\n\r\n';
var s = net.connect(PORT, HOST);
s.on('connect', function(){ s.write(hdr); s.write(body); s.end(); });
s.on('error', function(e){ console.log('ERR', e.message); });
