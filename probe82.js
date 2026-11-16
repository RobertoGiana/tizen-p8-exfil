"use strict";
var cp = require('child_process');
var net = require('net');
var HOST = '192.168.1.61';
var PORT = 9999;
function post(path, text) {
  var body = new Buffer(text, 'utf8');
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: text/plain\r\nContent-Length: ' + body.length + '\r\nConnection: close\r\n\r\n';
  var s = net.connect(PORT, HOST);
  s.on('connect', function(){ s.write(hdr); s.write(body); s.end(); });
  s.on('error', function(e){ console.log('ERR', e.message); });
}
post('/p82start', 'start ' + new Date().toISOString());
try {
  var out = cp.execSync('/usr/bin/dotnet-launcher /home/owner/share/tmp/sdk_tools/dotapp 2>&1', { timeout: 40000, maxBuffer: 16*1024*1024 }).toString();
  post('/p82done', 'done ' + new Date().toISOString() + '\n' + out.slice(0,1000));
} catch (e) {
  var o = '';
  if (e.stdout) o += e.stdout.toString();
  if (e.stderr) o += e.stderr.toString();
  post('/p82err', 'err ' + (e.status || '?') + '\n' + (o || e.message).slice(0,1000));
}
