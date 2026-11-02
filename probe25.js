"use strict";
/* p25: census — which apps are WAS + have download privilege; any CDP port open? */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var http = require('http');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p25', results: {}, log: [] };
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

// 1. Free My TV manifest
R.results.fmtv_manifest = run('cat /usr/apps/FreeMyTVio/tizen-manifest.xml 2>&1 | head -40; echo ===CONFIG===; cat /usr/apps/FreeMyTVio/config.xml 2>&1 | head -40', 15000);
R.results.fmtv_dir = run('ls -la /usr/apps/FreeMyTVio/ 2>&1 | head -20', 15000);

// 2. com.samsung.tv.store manifest
R.results.store_manifest = run('cat /usr/apps/com.samsung.tv.store/tizen-manifest.xml 2>&1 | grep -iE "privilege|download|type=|exec=" | head -30', 15000);

// 3. WAS + download privilege census (loop apps)
R.results.was_download = run("for d in /usr/apps/*/; do cfg=\"$d/config.xml\"; if [ -f \"$cfg\" ]; then if grep -q 'privilege/download' \"$cfg\" 2>/dev/null; then aid=$(grep -oE 'id=\"[^\"]*\"' \"$cfg\" 2>/dev/null | head -1); echo \"WAS+DL: ${d} $aid\"; fi; fi; done 2>&1 | head -40", 60000);

// 4. all config.xml with download (direct grep)
R.results.grep_download = run("grep -l 'privilege/download' /usr/apps/*/config.xml 2>/dev/null | head -40", 40000);

// 5. CDP port scan (proper: look for webSocketDebuggerUrl)
function probePort(port, cb){
  var req = http.get({ host:'127.0.0.1', port: port, path:'/json', timeout: 1200 }, function(res){
    var data = '';
    res.on('data', function(c){ data += c; });
    res.on('end', function(){
      if (data.indexOf('webSocketDebuggerUrl') >= 0) cb(port, 'CDP:'+data.substring(0,400), null);
      else cb(port, data.substring(0,120), 'noncdp');
    });
  });
  req.on('error', function(e){ cb(port, null, 'connerr'); });
  req.on('timeout', function(){ req.abort(); cb(port, null, 'timeout'); });
}
var ranges = [];
for (var p=8000; p<12000; p++) ranges.push(p);
for (var q=20000; q<20500; q++) ranges.push(q);
var cdpFound = [];
var otherJson = [];
var idx=0, CONC=200;
function scanNext(){
  if (idx >= ranges.length) {
    R.results.cdp_ports = cdpFound;
    R.results.other_json_ports = otherJson.slice(0,20);
    R.results.scan_done = true;
    finish();
    return;
  }
  var batch = ranges.slice(idx, idx+CONC); idx += CONC;
  var done=0;
  batch.forEach(function(port){
    probePort(port, function(port, info, err){
      if (info && info.indexOf('CDP:')===0) cdpFound.push(port);
      else if (info) otherJson.push(port+': '+info.substring(0,80));
      done++;
      if (done>=batch.length) scanNext();
    });
  });
}

function finish(){ R.results.final='done '+new Date().toISOString(); postRaw('/p25info', JSON.stringify(R)); L('p25 done'); }

scanNext();
