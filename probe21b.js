"use strict";
/* p21b: diagnose module require environment + node_modules location */
var fs = require('fs');
var net = require('net');
var HOST='192.168.1.62', PORT=9999;
var R = { ts: new Date().toISOString(), probe: 'p21b', results: {}, log: [] };
function L(s){ R.log.push(String(s).substring(0,500)); }

// test require of candidate modules
var mods = ['adbhost','chrome-remote-interface','ws','ws-old','ws-new','node-fetch','express','fs','net','child_process','path','http','https','url'];
mods.forEach(function(m){ try { require(m); R.results['req_'+m]='ok'; } catch(e){ R.results['req_'+m]='err '+String(e).substring(0,70); } });

// app info (service root)
try { R.results.appinfo = JSON.stringify(tizen.application.getAppInfo()).substring(0,500); } catch(e){ R.results.appinfo='err '+e; }
try { R.results.cwd = process.cwd ? process.cwd() : 'n/a'; } catch(e){ R.results.cwd='err '+e; }
try { R.results.pv = process.version; } catch(e){}

// require resolution paths
try { R.results.req_paths = JSON.stringify(require.resolve.paths ? require.resolve.paths('.') : 'no resolve.paths'); } catch(e){ R.results.req_paths='err '+e; }

// find the service/TizenBrew app dir + node_modules
var candidates = ['/home/owner/apps','/var/lib/apps','/var/home/owner/apps','/usr/apps/xvvl3S1bvH','/home/owner/share/tmp/sdk_tools','/opt/apps'];
candidates.forEach(function(d){ try{ R.results['ls_'+d.replace('/','_')] = fs.readdirSync(d).join(', ').substring(0,400); }catch(e){ R.results['ls_'+d.replace('/','_')]='err '+String(e).substring(0,60); } });

// Try to find node_modules dirs by scanning likely app roots
function findNodeModules(root, depth){
  var out=[];
  if(depth>4) return out;
  var entries;
  try { entries = fs.readdirSync(root); } catch(e){ return out; }
  entries.forEach(function(en){
    var p = root + '/' + en;
    var st;
    try { st = fs.statSync(p); } catch(e){ return; }
    if(st.isDirectory()){
      if(en==='node_modules'){ out.push(p); }
      else { out = out.concat(findNodeModules(p, depth+1)); }
    }
  });
  return out;
}
['/home/owner/apps','/var/lib/apps','/var/home/owner/apps'].forEach(function(root){
  try { R.results['nm_'+root.replace('/','_')] = findNodeModules(root, 4).join(' | ').substring(0,600); }
  catch(e){ R.results['nm_'+root.replace('/','_')]='err '+e; }
});

function postRaw(path, text){
  var buf = new Buffer(text,'utf8');
  var hdr = 'POST '+path+' HTTP/1.1\r\nHost: '+HOST+':9999\r\nContent-Type: text/plain\r\nContent-Length: '+buf.length+'\r\nConnection: close\r\n\r\n';
  try { var s=net.connect(PORT,HOST); s.on('connect',function(){ s.write(hdr); var off=0,iv=setInterval(function(){ if(off>=buf.length){clearInterval(iv);setTimeout(function(){s.destroy();},3000);return;} s.write(buf.slice(off,off+4096)); off+=4096;},100); setTimeout(function(){s.destroy();},60000);}); s.on('error',function(e){L('post err '+e.message);}); } catch(e){ L('post ctor '+e); }
}
R.results.final = 'done '+new Date().toISOString();
postRaw('/p21binfo', JSON.stringify(R));
L('p21b done');
