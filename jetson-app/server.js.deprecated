const http = require('http');
const { exec, spawn } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => { console.error('Uncaught:', err.message); try { logBridge('error', 'process.uncaught_exception', { error: err.message, stack: err.stack }); } catch {} });
process.on('unhandledRejection', (err) => { console.error('Unhandled:', err); try { logBridge('error', 'process.unhandled_rejection', { error: String(err && err.message || err) }); } catch {} });

const sessions = {};

const ROS_ENV = 'source /opt/ros/humble/setup.bash && source ~/ros2_ws/install/setup.bash 2>/dev/null && export ROS_DOMAIN_ID=42 && export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp && export CYCLONEDDS_URI=file://$HOME/cyclonedds.xml';

const SAFE_ID = /^[A-Za-z0-9_.-]+$/;
const MANAGED_SERVICES = new Set(['agrotech-rosbridge', 'agrotech-camera', 'agrotech-imu']);
const RECORDINGS_ROOT = '/AgroTech_recordings';
const EVENTS_LOG = `${RECORDINGS_ROOT}/_events.jsonl`;
const ALLOWED_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const ALLOWED_SOURCES = new Set(['frontend', 'bridge', 'camera_node', 'mcap_recorder', 'mcap_player', 'systemd', 'unknown']);

// Append one event line to /AgroTech_recordings/_events.jsonl. Self-tagging server events.
const writeEvent = (e) => {
  try {
    const line = JSON.stringify({
      ts: e.ts || new Date().toISOString(),
      level: ALLOWED_LEVELS.has(e.level) ? e.level : 'info',
      source: ALLOWED_SOURCES.has(e.source) ? e.source : 'unknown',
      event: String(e.event || 'unknown').slice(0, 200),
      ...(e.customer ? { customer: String(e.customer).slice(0, 80) } : {}),
      ...(e.device ? { device: String(e.device).slice(0, 80) } : {}),
      ...(e.patrol ? { patrol: String(e.patrol).slice(0, 80) } : {}),
      ...(e.recording ? { recording: String(e.recording).slice(0, 80) } : {}),
      ...(e.meta && typeof e.meta === 'object' ? { meta: e.meta } : {}),
    }) + '\n';
    fs.appendFileSync(EVENTS_LOG, line);
  } catch (err) {
    // Last resort — never let logging take the bridge down.
    process.stderr.write(`[events] write failed: ${err.message}\n`);
  }
};

const logBridge = (level, event, meta) => writeEvent({ level, source: 'bridge', event, meta });

const localRun = (command) => new Promise((resolve, reject) => {
  exec(command, { shell: '/bin/bash', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err && !stdout) return reject(err);
    resolve(stdout + stderr);
  });
});

// Wait until tmux session named `id` is gone, polling every 500ms up to timeoutMs.
const waitForSessionGone = async (id, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const out = await localRun(`ls /tmp/tmux-* >/dev/null 2>&1 && tmux has-session -t ${id} 2>/dev/null && echo ALIVE || echo DEAD`);
      if (out.trim() === 'DEAD') return true;
    } catch { return true; }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve static files for GET requests
  if (req.method === 'GET' && !req.url.startsWith('/api/')) {
    const buildDir = path.join(__dirname, 'build');
    let filePath = path.join(buildDir, req.url === '/' ? 'index.html' : req.url);
    if (!fs.existsSync(filePath)) filePath = path.join(buildDir, 'index.html');
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}

    // Normalize: accept both /api/* and /ssh/* routes
    const url = req.url.replace(/^\/ssh\//, '/api/').replace(/^\/s3\//, '/api/s3/');

    if (url === '/api/launch' && req.method === 'POST') {
      const { id, command } = parsed;
      if (!SAFE_ID.test(id || '')) { json({ ok: false, error: `Invalid session id: ${id}` }); return; }
      localRun(`ls /tmp/tmux-* >/dev/null 2>&1 && tmux has-session -t ${id} 2>/dev/null && echo ALIVE || echo DEAD`)
        .then(async (out) => {
          if (out.trim() === 'ALIVE') {
            // Adopt-or-kill UX: return uptime + last log line so UI can decide.
            const logFile = (sessions[id] && sessions[id].logFile) || `/tmp/agrotech_${id}.log`;
            let info = { uptime: null, lastLine: '', logFile };
            try {
              const dur = await localRun(`tmux display-message -p -t ${id} '#{session_created}' 2>/dev/null`);
              const created = parseInt(dur.trim()) || 0;
              if (created) info.uptime = Math.max(0, Math.floor(Date.now() / 1000) - created);
            } catch {}
            try {
              const tail = await localRun(`tail -n 1 ${logFile} 2>/dev/null || true`);
              info.lastLine = tail.trim();
            } catch {}
            json({ ok: false, error: `Session "${id}" already running.`, alive: true, ...info });
            return;
          }
          const logFile = `/tmp/agrotech_${id}.log`;
          const escaped = command.replace(/"/g, '\\"');
          const tmuxCmd = `rm -f ${logFile} && tmux new-session -d -s ${id} "${escaped}" && tmux pipe-pane -t ${id} 'cat >> ${logFile}'`;
          await localRun(tmuxCmd);
          sessions[id] = { command, logFile };
          logBridge('info', 'tmux.launch', { id });
          json({ ok: true, message: `[${id}] launched` });
        })
        .catch((err) => { logBridge('error', 'tmux.launch.failed', { id, error: err.message }); json({ ok: false, error: err.message }); });

    } else if (url === '/api/stop' && req.method === 'POST') {
      const { id, force } = parsed;
      if (!SAFE_ID.test(id || '')) { json({ ok: false, error: `Invalid session id: ${id}` }); return; }
      const s = sessions[id] || {};
      const logFile = s.logFile || `/tmp/agrotech_${id}.log`;
      // Graceful: SIGINT, poll up to 15s, then kill if still alive.
      localRun(`tmux send-keys -t ${id} C-c 2>/dev/null || true; echo SENT`)
        .then(async () => {
          const gone = await waitForSessionGone(id, force ? 0 : 15000);
          let killed = false;
          if (!gone) {
            await localRun(`tmux kill-session -t ${id} 2>/dev/null || true`);
            killed = true;
          }
          await localRun(`rm -f ${logFile}`);
          delete sessions[id];
          logBridge(killed ? 'warn' : 'info', killed ? 'tmux.stop.killed' : 'tmux.stop.graceful', { id });
          json({ ok: true, message: `[${id}] stopped`, killed });
        })
        .catch(() => { delete sessions[id]; logBridge('warn', 'tmux.stop.error', { id }); json({ ok: true, message: `[${id}] stopped (force)`, killed: true }); });

    } else if (url === '/api/output' && req.method === 'POST') {
      const { id, since } = parsed;
      if (!SAFE_ID.test(id || '')) { json({ ok: true, lines: '', offset: 0, done: true }); return; }
      const s = sessions[id];
      if (!s) { json({ ok: true, lines: '', offset: 0, done: true }); return; }
      const logFile = s.logFile || `/tmp/agrotech_${id}.log`;
      localRun(`(ls /tmp/tmux-* >/dev/null 2>&1 && tmux has-session -t ${id} 2>/dev/null && echo __ALIVE__ || echo __DEAD__); cat ${logFile} 2>/dev/null`)
        .then((out) => {
          const done = out.includes('__DEAD__');
          const clean = out.replace('__ALIVE__\n', '').replace('__DEAD__\n', '');
          const offset = clean.length;
          const fresh = since ? clean.slice(since) : clean;
          json({ ok: true, lines: fresh, offset, done });
          if (done) delete sessions[id];
        })
        .catch(() => json({ ok: true, lines: '', offset: 0, done: true }));

    } else if (url === '/api/exec' && req.method === 'POST') {
      const { command } = parsed;
      localRun(command)
        .then((out) => json({ ok: true, output: out }))
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (url === '/api/log' && req.method === 'POST') {
      // Accept either {events:[...]} batch or a single event.
      const events = Array.isArray(parsed.events) ? parsed.events : (parsed.event ? [parsed] : []);
      let written = 0;
      for (const e of events) {
        if (!e || typeof e !== 'object') continue;
        writeEvent(e);
        written++;
      }
      json({ ok: true, written });

    } else if (url === '/api/log/list' && req.method === 'POST') {
      // Filters: { recording, patrol, level, source, since (ms epoch or iso), limit (default 500) }
      const { recording, patrol, level, source, since, limit } = parsed;
      const max = Math.max(1, Math.min(parseInt(limit) || 500, 5000));
      try {
        if (!fs.existsSync(EVENTS_LOG)) { json({ ok: true, events: [] }); return; }
        // Read tail efficiently for large files: cap at last 4 MB to avoid pulling huge logs.
        const stat = fs.statSync(EVENTS_LOG);
        const READ_TAIL = 4 * 1024 * 1024;
        const start = Math.max(0, stat.size - READ_TAIL);
        const fd = fs.openSync(EVENTS_LOG, 'r');
        const buf = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        const text = buf.toString('utf8');
        // If we sliced mid-line, drop the first partial line.
        const lines = text.split('\n').filter(Boolean);
        if (start > 0 && lines.length) lines.shift();
        const sinceMs = since ? (typeof since === 'number' ? since : new Date(since).getTime()) : 0;
        const out = [];
        // Iterate newest-first by reading bottom-up.
        for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
          let e;
          try { e = JSON.parse(lines[i]); } catch { continue; }
          if (recording && e.recording !== recording) continue;
          if (patrol && e.patrol !== patrol) continue;
          if (level && e.level !== level) continue;
          if (source && e.source !== source) continue;
          if (sinceMs && new Date(e.ts).getTime() < sinceMs) continue;
          out.push(e);
        }
        json({ ok: true, events: out, total_scanned: lines.length, file_size: stat.size });
      } catch (err) {
        json({ ok: false, error: err.message });
      }

    } else if (url === '/api/config' && req.method === 'POST') {
      json({
        ok: true,
        customerId: process.env.AGROTECH_CUSTOMER_ID || '',
        deviceId: process.env.AGROTECH_DEVICE_ID || '',
      });

    } else if (url === '/api/services/status' && req.method === 'POST') {
      const names = Array.from(MANAGED_SERVICES);
      Promise.all(names.map(async (n) => {
        try {
          const active = (await localRun(`systemctl is-active ${n}.service 2>&1 || true`)).trim();
          const enabled = (await localRun(`systemctl is-enabled ${n}.service 2>&1 || true`)).trim();
          let uptime = null;
          if (active === 'active') {
            try {
              const ts = (await localRun(`systemctl show -p ActiveEnterTimestampMonotonic --value ${n}.service 2>/dev/null`)).trim();
              const monoNow = parseFloat((await localRun(`awk '{print $1}' /proc/uptime 2>/dev/null`)).trim());
              const monoStart = parseInt(ts) / 1e6;
              if (!isNaN(monoNow) && !isNaN(monoStart)) uptime = Math.max(0, Math.floor(monoNow - monoStart));
            } catch {}
          }
          return { name: n, active, enabled, uptime };
        } catch (e) { return { name: n, active: 'unknown', enabled: 'unknown', uptime: null, error: e.message }; }
      })).then((services) => json({ ok: true, services }));

    } else if (url === '/api/services/restart' && req.method === 'POST') {
      const { name, action } = parsed;
      if (!MANAGED_SERVICES.has(name)) { json({ ok: false, error: `Service not managed: ${name}` }); return; }
      const verb = ['start', 'stop', 'restart'].includes(action) ? action : 'restart';
      // Requires passwordless sudo for systemctl, OR a sudoers rule for `ada`. We use `sudo -n`
      // and surface the error verbatim if the operator hasn't set that up yet.
      localRun(`sudo -n systemctl ${verb} ${name}.service 2>&1`)
        .then((out) => { logBridge('info', 'service.action', { name, action: verb }); json({ ok: true, output: out, action: verb, name }); })
        .catch((err) => { logBridge('error', 'service.action.failed', { name, action: verb, error: err.message }); json({ ok: false, error: err.message }); });

    } else if (url === '/api/preflight' && req.method === 'POST') {
      const { company, device, patrol, recording } = parsed;
      if (![company, device, patrol, recording].every(v => SAFE_ID.test(v || ''))) {
        json({ ok: false, error: 'Invalid identifier (must match [A-Za-z0-9_.-]+)' });
        return;
      }
      const recDir = `${RECORDINGS_ROOT}/${company}/${device}/${patrol}/${recording}`;
      (async () => {
        const result = { ok: true, checks: {} };
        // Disk
        try {
          const dfOut = await localRun(`df -BM --output=avail ${RECORDINGS_ROOT} 2>/dev/null | tail -n 1`);
          const availMB = parseInt(dfOut.trim().replace('M', '')) || 0;
          result.checks.disk = { availMB, ok: availMB >= 1024, warn: availMB < 5120 };
        } catch { result.checks.disk = { availMB: 0, ok: false }; }
        // Services
        const svcStatus = {};
        for (const n of MANAGED_SERVICES) {
          try { svcStatus[n] = (await localRun(`systemctl is-active ${n}.service 2>&1 || true`)).trim(); }
          catch { svcStatus[n] = 'unknown'; }
        }
        result.checks.services = svcStatus;
        result.checks.servicesOk = Object.values(svcStatus).every(s => s === 'active');
        // Stale recorder process — match the actual python invocation, not arbitrary substrings.
        try {
          const pg = await localRun(`pgrep -f '^python3 /home/ada/mcap_recorder.py' 2>/dev/null || true`);
          result.checks.staleRecorder = pg.trim().length > 0 ? pg.trim().split('\n') : [];
        } catch { result.checks.staleRecorder = []; }
        // Stale tmux session
        try {
          const sess = await localRun(`ls /tmp/tmux-* >/dev/null 2>&1 && tmux has-session -t mcap_recorder 2>/dev/null && echo ALIVE || echo DEAD`);
          result.checks.staleTmux = sess.trim() === 'ALIVE';
        } catch { result.checks.staleTmux = false; }
        // Existing recording dir (overwrite check)
        try {
          const dir = await localRun(`test -d ${recDir} && echo EXISTS || echo NO`);
          result.checks.recordingExists = dir.trim() === 'EXISTS';
        } catch { result.checks.recordingExists = false; }
        json(result);
      })();

    } else if (url === '/api/mcap-info' && req.method === 'POST') {
      const { company, device, patrol, recording, file } = parsed;
      if (![company, device, patrol, recording].every(v => SAFE_ID.test(v || ''))) {
        json({ ok: false, error: 'Invalid identifier' });
        return;
      }
      const safeFile = (file || 'combined.mcap').replace(/[^A-Za-z0-9_.-]/g, '');
      const recDir = `${RECORDINGS_ROOT}/${company}/${device}/${patrol}/${recording}`;
      const filePath = `${recDir}/${safeFile}`;
      localRun(`test -f ${filePath} && (stat --format='%s' ${filePath}; ${ROS_ENV} && ros2 bag info ${recDir} 2>&1 | head -25) || echo MISSING`)
        .then((out) => {
          const exists = !out.startsWith('MISSING');
          const lines = out.split('\n');
          const sizeBytes = exists ? parseInt(lines[0]) || 0 : 0;
          json({ ok: true, exists, sizeBytes, info: exists ? lines.slice(1).join('\n') : '' });
        })
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (url === '/api/s3/upload' && req.method === 'POST') {
      const { patrol, recording, bucket, prefix, region, accessKeyId, secretAccessKey } = parsed;
      const uploadId = `${patrol}/${recording}`;
      if (!global.uploads) global.uploads = {};
      global.uploads[uploadId] = { status: 'listing', files: [], uploaded: 0, total: 0, errors: [] };

      const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
      const basePath = `/AgroTech_recordings/${patrol}/${recording}/`;

      localRun(`find ${basePath} -type f -exec stat --format='%n|%s' {} \\;`)
        .then(async (out) => {
          const files = out.trim().split('\n').filter(Boolean).map(l => {
            const [p, size] = l.split('|');
            return { path: p, rel: p.replace(basePath, ''), size: parseInt(size) || 0 };
          });
          global.uploads[uploadId].files = files.map(f => f.rel);
          global.uploads[uploadId].total = files.length;
          global.uploads[uploadId].status = 'uploading';

          for (const f of files) {
            try {
              const data = fs.readFileSync(f.path);
              const s3Key = `${prefix || ''}${patrol}/${recording}/${f.rel}`;
              await s3.send(new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: data }));
            } catch (e) {
              global.uploads[uploadId].errors.push(`${f.rel}: ${e.message}`);
            }
            global.uploads[uploadId].uploaded++;
          }
          global.uploads[uploadId].status = 'done';
        })
        .catch((err) => {
          global.uploads[uploadId] = { status: 'error', errors: [err.message], uploaded: 0, total: 0 };
        });
      json({ ok: true, message: `Upload started: ${uploadId}` });

    } else if (url === '/api/s3/status' && req.method === 'POST') {
      const { patrol, recording } = parsed;
      const info = (global.uploads || {})[`${patrol}/${recording}`];
      json(info || { status: 'idle' });

    } else {
      json({ ok: true, sessions: Object.keys(sessions) });
    }
  });
});

const PORT = process.env.PORT || 4500;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`AgroTech bridge listening on :${PORT}`);
  logBridge('info', 'bridge.start', { port: PORT, customer: process.env.AGROTECH_CUSTOMER_ID || null, device: process.env.AGROTECH_DEVICE_ID || null });
});
