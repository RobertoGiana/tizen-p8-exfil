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
post('/p93start', 'start ' + new Date().toISOString());
var out = [];
var opts = ['-g 1','-f 1','-v 1','-n','-t','-p','-s','-w','-c','-r'];
for (var i=0;i<opts.length;i++) {
  var cmd = '/usr/bin/wasutility ' + opts[i] + ' "echo hi > /opt/dbspace/was_test_' + i + '"';
  out.push(cmd + ' => ' + run(cmd, 15000));
}
out.push('ls => ' + run('ls -la /opt/dbspace/was_test_* 2>&1', 10000));
post('/p93out', out.join('\n'));
