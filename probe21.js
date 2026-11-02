"use strict";
/* p21: Download API via CDP into Free My TV page — deliver journal to /opt/dbspace */
var cp = require('child_process');
var net = require('net');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p21', results: {}, log: [] };
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

var TARGET_APP = 'FreeMyTVio.FreeMyTV';
var JURL = 'http://192.168.1.62:9999/appctx_hot_journal';
var JDEST = '/opt/dbspace/.app-context.db-journal';

// baseline
R.results.live_before = run('md5sum /opt/dbspace/.app-context.db 2>&1', 10000);
R.results.journal_before = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 10000);
R.results.dbspace_before = run('ls -la /opt/dbspace/ 2>&1 | head -30', 10000);

// require checks
var adbhost=null, CDP=null;
try { adbhost = require('adbhost'); R.results.adbhost='ok'; } catch(e){ R.results.adbhost='err '+e; }
try { CDP = require('chrome-remote-interface'); R.results.cdp='ok'; } catch(e){ R.results.cdp='err '+e; }

function finish(){ R.results.final='done '+new Date().toISOString(); postRaw('/p21info', JSON.stringify(R)); L('p21 done'); }

function doCDP(port){
  if(!CDP){ finish(); return; }
  var evaluated=false;
  CDP({ port: port, host:'127.0.0.1', local:true }, function(client){
    R.results.cdp_connected = port;
    client.Runtime.enable();
    function evalInPage(contextId){
      if (evaluated) return; evaluated=true;
      var setupJS = '(function(){ window.__dl={start:Date.now(),tizen:typeof tizen,dl:(typeof tizen!=="undefined")?typeof tizen.download:"none",status:"pending",progress:"",err:"",done:""}; try{ tizen.download.download('+JSON.stringify(JURL)+', '+JSON.stringify(JDEST)+', function(d,t){window.__dl.progress=d+"/"+t;}, function(e){window.__dl.err=String(e&&e.message||e);window.__dl.status="error";}, function(d,t){window.__dl.done=d+"/"+t;window.__dl.status="complete";}); window.__dl.status="started"; }catch(e){window.__dl.err=String(e);window.__dl.status="exception";} return JSON.stringify(window.__dl); })()';
      client.Runtime.evaluate({ expression:setupJS, contextId:contextId, returnByValue:true }).then(function(res){
        R.results.eval_setup = JSON.stringify(res.result ? res.result.value : res).substring(0,800);
        setTimeout(function(){
          client.Runtime.evaluate({ expression:'JSON.stringify(window.__dl)', contextId:contextId, returnByValue:true }).then(function(res2){
            R.results.eval_readback = JSON.stringify(res2.result ? res2.result.value : res2).substring(0,800);
            R.results.journal_after = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 10000);
            R.results.dbspace_after = run('ls -la /opt/dbspace/ 2>&1 | head -40', 10000);
            finish();
          }).catch(function(e){ R.results.readback_err=String(e); finish(); });
        }, 20000);
      }).catch(function(e){ R.results.eval_setup_err=String(e); finish(); });
    }
    client.on('Runtime.executionContextCreated', function(msg){ evalInPage(msg.context.id); });
    setTimeout(function(){ if(!evaluated) evalInPage(1); }, 5000);
  }).on('error', function(err){ R.results.cdp_error=String(err); setTimeout(finish, 5000); });
}

function getDebugPort(cb){
  if(!adbhost){ R.results.note='no adbhost'; cb(null); return; }
  var done=false;
  function go(p){ if(done)return; done=true; cb(p); }
  try {
    var adbClient = adbhost.createConnection({ host:'127.0.0.1', port:26101 });
    var shellCmd = adbClient.createStream('shell:0 debug '+TARGET_APP);
    var raw='';
    shellCmd.on('data', function(data){
      raw += data.toString();
      L('adb: '+raw.substring(0,300));
      // parse: find a 4-6 digit number
      var m = raw.match(/(\d{3,6})/);
      if (m){ R.results.debug_raw = raw.substring(0,400); R.results.debug_port = Number(m[1]); setTimeout(function(){ go(Number(m[1])); }, 2000); }
    });
    shellCmd.on('error', function(e){ L('adb err '+e); });
    setTimeout(function(){ if(!done){ R.results.debug_raw = raw.substring(0,400); R.results.note='adb timeout, raw captured'; go(null); } }, 15000);
  } catch(e){ R.results.adb_err=String(e); go(null); }
}

if(!adbhost || !CDP){ finish(); }
else {
  getDebugPort(function(port){
    if(port){ L('got debug port '+port+' — CDP connect'); doCDP(port); }
    else { R.results.note='no debug port; Free My TV may not be WAS or not running'; finish(); }
  });
}
