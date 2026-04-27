const http = require('http');
const { Client } = require('ssh2');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));

const sessions = {}; // track launched session metadata

const SAFE_ID = /^[A-Za-z0-9_.-]+$/;
const MANAGED_SERVICES = new Set(['agrotech-rosbridge', 'agrotech-camera', 'agrotech-imu']);
const RECORDINGS_ROOT = '/AgroTech_recordings';
const EVENTS_LOG = `${RECORDINGS_ROOT}/_events.jsonl`;
const ALLOWED_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const ALLOWED_SOURCES = new Set(['frontend', 'bridge', 'camera_node', 'mcap_recorder', 'mcap_player', 'systemd', 'unknown']);

// Build the JSON line (same shape as the on-Jetson server) and append remotely via SSH.
const eventLine = (e) => JSON.stringify({
  ts: e.ts || new Date().toISOString(),
  level: ALLOWED_LEVELS.has(e.level) ? e.level : 'info',
  source: ALLOWED_SOURCES.has(e.source) ? e.source : 'unknown',
  event: String(e.event || 'unknown').slice(0, 200),
  ...(e.customer ? { customer: String(e.customer).slice(0, 80) } : {}),
  ...(e.device ? { device: String(e.device).slice(0, 80) } : {}),
  ...(e.patrol ? { patrol: String(e.patrol).slice(0, 80) } : {}),
  ...(e.recording ? { recording: String(e.recording).slice(0, 80) } : {}),
  ...(e.meta && typeof e.meta === 'object' ? { meta: e.meta } : {}),
});

// Append events to the Jetson's events file via SSH.
const writeEventsRemote = async (host, user, password, events) => {
  const lines = events.map(eventLine).join('\n') + '\n';
  // base64 to avoid quoting headaches with arbitrary JSON content
  const b64 = Buffer.from(lines, 'utf8').toString('base64');
  await sshRun(host, user, password, `printf '%s' '${b64}' | base64 -d >> ${EVENTS_LOG}`);
};
const ROS_ENV = 'source /opt/ros/humble/setup.bash && source ~/ros2_ws/install/setup.bash 2>/dev/null && export ROS_DOMAIN_ID=42 && export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp && export CYCLONEDDS_URI=file://$HOME/cyclonedds.xml';

const sshRun = (host, user, password, command) => new Promise((resolve, reject) => {
  const conn = new Client();
  conn.on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) { conn.end(); return reject(err); }
      let out = '';
      stream.on('data', (d) => (out += d.toString()));
      stream.stderr.on('data', (d) => (out += d.toString()));
      stream.on('close', () => { conn.end(); resolve(out); });
    });
  });
  conn.on('error', reject);
  conn.connect({ host, port: 22, username: user, password, keepaliveInterval: 10000 });
});

const waitForSessionGone = async (host, user, password, id, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const out = await sshRun(host, user, password, `ls /tmp/tmux-* >/dev/null 2>&1 && tmux has-session -t ${id} 2>/dev/null && echo ALIVE || echo DEAD`);
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

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}

    if (req.url === '/ssh/launch' && req.method === 'POST') {
      const { id, host, user, password, command } = parsed;
      if (!SAFE_ID.test(id || '')) { json({ ok: false, error: `Invalid session id: ${id}` }); return; }

      sshRun(host, user, password, `ls /tmp/tmux-* >/dev/null 2>&1 && tmux has-session -t ${id} 2>/dev/null && echo ALIVE || echo DEAD`)
        .then(async (out) => {
          if (out.trim() === 'ALIVE') {
            const logFile = (sessions[id] && sessions[id].logFile) || `/tmp/agrotech_${id}.log`;
            let info = { uptime: null, lastLine: '', logFile };
            try {
              const dur = await sshRun(host, user, password, `tmux display-message -p -t ${id} '#{session_created}' 2>/dev/null`);
              const created = parseInt(dur.trim()) || 0;
              if (created) info.uptime = Math.max(0, Math.floor(Date.now() / 1000) - created);
            } catch {}
            try {
              const tail = await sshRun(host, user, password, `tail -n 1 ${logFile} 2>/dev/null || true`);
              info.lastLine = tail.trim();
            } catch {}
            json({ ok: false, error: `Session "${id}" already running.`, alive: true, ...info });
            return;
          }
          const logFile = `/tmp/agrotech_${id}.log`;
          const escaped = command.replace(/"/g, '\\"');
          const tmuxCmd = `rm -f ${logFile} && tmux new-session -d -s ${id} "${escaped}"` +
            ` && tmux pipe-pane -t ${id} 'cat >> ${logFile}'`;
          await sshRun(host, user, password, tmuxCmd);
          sessions[id] = { host, user, password, command, logFile };
          json({ ok: true, message: `[${id}] launched on ${user}@${host}` });
        })
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (req.url === '/ssh/stop' && req.method === 'POST') {
      const { id, host, user, password, force } = parsed;
      if (!SAFE_ID.test(id || '')) { json({ ok: false, error: `Invalid session id: ${id}` }); return; }
      const s = sessions[id] || {};
      const h = s.host || host;
      const u = s.user || user;
      const p = s.password || password;
      if (!h || !u || !p) { json({ ok: true, message: `[${id}] no session info` }); return; }
      const logFile = s.logFile || `/tmp/agrotech_${id}.log`;
      sshRun(h, u, p, `tmux send-keys -t ${id} C-c 2>/dev/null || true; echo SENT`)
        .then(async () => {
          const gone = await waitForSessionGone(h, u, p, id, force ? 0 : 15000);
          let killed = false;
          if (!gone) {
            await sshRun(h, u, p, `tmux kill-session -t ${id} 2>/dev/null || true`);
            killed = true;
          }
          await sshRun(h, u, p, `rm -f ${logFile}`);
          delete sessions[id];
          json({ ok: true, message: `[${id}] stopped`, killed });
        })
        .catch(() => { delete sessions[id]; json({ ok: true, message: `[${id}] stopped (force)`, killed: true }); });

    } else if (req.url === '/ssh/output' && req.method === 'POST') {
      const { id, since } = parsed;
      if (!SAFE_ID.test(id || '')) { json({ ok: true, lines: '', offset: 0, done: true }); return; }
      const s = sessions[id];
      if (!s) { json({ ok: true, lines: '', offset: 0, done: true }); return; }
      const logFile = s.logFile || `/tmp/agrotech_${id}.log`;
      sshRun(s.host, s.user, s.password,
        `(ls /tmp/tmux-* >/dev/null 2>&1 && tmux has-session -t ${id} 2>/dev/null && echo __ALIVE__ || echo __DEAD__); cat ${logFile} 2>/dev/null`
      )
        .then((out) => {
          const done = out.includes('__DEAD__');
          const clean = out.replace('__ALIVE__\n', '').replace('__DEAD__\n', '');
          const offset = clean.length;
          const fresh = since ? clean.slice(since) : clean;
          json({ ok: true, lines: fresh, offset, done });
          if (done) delete sessions[id];
        })
        .catch(() => json({ ok: true, lines: '', offset: 0, done: true }));

    } else if (req.url === '/ssh/exec' && req.method === 'POST') {
      const { host, user, password, command } = parsed;
      sshRun(host, user, password, command)
        .then((out) => json({ ok: true, output: out }))
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (req.url === '/ssh/log' && req.method === 'POST') {
      const { host, user, password, events, event } = parsed;
      const list = Array.isArray(events) ? events : (event ? [parsed] : []);
      if (list.length === 0) { json({ ok: true, written: 0 }); return; }
      writeEventsRemote(host, user, password, list)
        .then(() => json({ ok: true, written: list.length }))
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (req.url === '/ssh/log/list' && req.method === 'POST') {
      const { host, user, password, recording, patrol, level, source, since, limit } = parsed;
      const max = Math.max(1, Math.min(parseInt(limit) || 500, 5000));
      // Tail last 4 MB on the Jetson, then filter client-side here.
      sshRun(host, user, password, `[ -f ${EVENTS_LOG} ] && tail -c 4194304 ${EVENTS_LOG} || echo ""`)
        .then((text) => {
          const lines = text.split('\n').filter(Boolean);
          // Drop possibly-truncated first line if the file is larger than 4 MB.
          const out = [];
          const sinceMs = since ? (typeof since === 'number' ? since : new Date(since).getTime()) : 0;
          for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
            let e; try { e = JSON.parse(lines[i]); } catch { continue; }
            if (recording && e.recording !== recording) continue;
            if (patrol && e.patrol !== patrol) continue;
            if (level && e.level !== level) continue;
            if (source && e.source !== source) continue;
            if (sinceMs && new Date(e.ts).getTime() < sinceMs) continue;
            out.push(e);
          }
          json({ ok: true, events: out, total_scanned: lines.length });
        })
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (req.url === '/ssh/config' && req.method === 'POST') {
      const { host, user, password } = parsed;
      sshRun(host, user, password, 'echo "$AGROTECH_CUSTOMER_ID|$AGROTECH_DEVICE_ID"; systemctl show agrotech-app.service -p Environment --value 2>/dev/null')
        .then((out) => {
          // First non-empty line of stdin echo first; else parse `Environment=...` block.
          let customerId = '', deviceId = '';
          const direct = out.split('\n').find(l => l.includes('|'));
          if (direct) { const [c, d] = direct.split('|'); customerId = (c || '').trim(); deviceId = (d || '').trim(); }
          if (!customerId || !deviceId) {
            const envLine = out.split('\n').find(l => l.includes('AGROTECH_'));
            if (envLine) {
              const m1 = envLine.match(/AGROTECH_CUSTOMER_ID=(\S+)/); if (m1) customerId = m1[1];
              const m2 = envLine.match(/AGROTECH_DEVICE_ID=(\S+)/);   if (m2) deviceId = m2[1];
            }
          }
          json({ ok: true, customerId, deviceId });
        })
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (req.url === '/ssh/services/status' && req.method === 'POST') {
      const { host, user, password } = parsed;
      const names = Array.from(MANAGED_SERVICES);
      Promise.all(names.map(async (n) => {
        try {
          const active = (await sshRun(host, user, password, `systemctl is-active ${n}.service 2>&1 || true`)).trim();
          const enabled = (await sshRun(host, user, password, `systemctl is-enabled ${n}.service 2>&1 || true`)).trim();
          let uptime = null;
          if (active === 'active') {
            try {
              const ts = (await sshRun(host, user, password, `systemctl show -p ActiveEnterTimestampMonotonic --value ${n}.service 2>/dev/null`)).trim();
              const monoNow = parseFloat((await sshRun(host, user, password, `awk '{print $1}' /proc/uptime 2>/dev/null`)).trim());
              const monoStart = parseInt(ts) / 1e6;
              if (!isNaN(monoNow) && !isNaN(monoStart)) uptime = Math.max(0, Math.floor(monoNow - monoStart));
            } catch {}
          }
          return { name: n, active, enabled, uptime };
        } catch (e) { return { name: n, active: 'unknown', enabled: 'unknown', uptime: null, error: e.message }; }
      })).then((services) => json({ ok: true, services }));

    } else if (req.url === '/ssh/services/restart' && req.method === 'POST') {
      const { host, user, password, name, action } = parsed;
      if (!MANAGED_SERVICES.has(name)) { json({ ok: false, error: `Service not managed: ${name}` }); return; }
      const verb = ['start', 'stop', 'restart'].includes(action) ? action : 'restart';
      sshRun(host, user, password, `sudo -n systemctl ${verb} ${name}.service 2>&1`)
        .then((out) => json({ ok: true, output: out, action: verb, name }))
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (req.url === '/ssh/preflight' && req.method === 'POST') {
      const { host, user, password, company, device, patrol, recording } = parsed;
      if (![company, device, patrol, recording].every(v => SAFE_ID.test(v || ''))) {
        json({ ok: false, error: 'Invalid identifier (must match [A-Za-z0-9_.-]+)' });
        return;
      }
      const recDir = `${RECORDINGS_ROOT}/${company}/${device}/${patrol}/${recording}`;
      (async () => {
        const result = { ok: true, checks: {} };
        try {
          const dfOut = await sshRun(host, user, password, `df -BM --output=avail ${RECORDINGS_ROOT} 2>/dev/null | tail -n 1`);
          const availMB = parseInt(dfOut.trim().replace('M', '')) || 0;
          result.checks.disk = { availMB, ok: availMB >= 1024, warn: availMB < 5120 };
        } catch { result.checks.disk = { availMB: 0, ok: false }; }
        const svcStatus = {};
        for (const n of MANAGED_SERVICES) {
          try { svcStatus[n] = (await sshRun(host, user, password, `systemctl is-active ${n}.service 2>&1 || true`)).trim(); }
          catch { svcStatus[n] = 'unknown'; }
        }
        result.checks.services = svcStatus;
        result.checks.servicesOk = Object.values(svcStatus).every(s => s === 'active');
        try {
          const pg = await sshRun(host, user, password, `pgrep -f '^python3 /home/ada/mcap_recorder.py' 2>/dev/null || true`);
          result.checks.staleRecorder = pg.trim().length > 0 ? pg.trim().split('\n') : [];
        } catch { result.checks.staleRecorder = []; }
        try {
          const sess = await sshRun(host, user, password, `ls /tmp/tmux-* >/dev/null 2>&1 && tmux has-session -t mcap_recorder 2>/dev/null && echo ALIVE || echo DEAD`);
          result.checks.staleTmux = sess.trim() === 'ALIVE';
        } catch { result.checks.staleTmux = false; }
        try {
          const dir = await sshRun(host, user, password, `test -d ${recDir} && echo EXISTS || echo NO`);
          result.checks.recordingExists = dir.trim() === 'EXISTS';
        } catch { result.checks.recordingExists = false; }
        json(result);
      })();

    } else if (req.url === '/ssh/mcap-info' && req.method === 'POST') {
      const { host, user, password, company, device, patrol, recording, file } = parsed;
      if (![company, device, patrol, recording].every(v => SAFE_ID.test(v || ''))) {
        json({ ok: false, error: 'Invalid identifier' });
        return;
      }
      const safeFile = (file || 'combined.mcap').replace(/[^A-Za-z0-9_.-]/g, '');
      const recDir = `${RECORDINGS_ROOT}/${company}/${device}/${patrol}/${recording}`;
      const filePath = `${recDir}/${safeFile}`;
      sshRun(host, user, password, `test -f ${filePath} && (stat --format='%s' ${filePath}; ${ROS_ENV} && ros2 bag info ${recDir} 2>&1 | head -25) || echo MISSING`)
        .then((out) => {
          const exists = !out.startsWith('MISSING');
          const lines = out.split('\n');
          const sizeBytes = exists ? parseInt(lines[0]) || 0 : 0;
          json({ ok: true, exists, sizeBytes, info: exists ? lines.slice(1).join('\n') : '' });
        })
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (req.url === '/s3/upload' && req.method === 'POST') {
      const { host, user, password, patrol, recording, bucket, prefix, region, accessKeyId, secretAccessKey } = parsed;
      const uploadId = `${patrol}/${recording}`;

      if (!global.uploads) global.uploads = {};
      global.uploads[uploadId] = { status: 'listing', files: [], uploaded: 0, total: 0, errors: [] };

      const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
      const sshConn = new Client();

      sshConn.on('ready', () => {
        sshConn.exec(`find /AgroTech_recordings/${patrol}/${recording} -type f -exec stat --format='%n|%s' {} \\;`, (err, stream) => {
          if (err) { json({ ok: false, error: err.message }); sshConn.end(); return; }
          let out = '';
          stream.on('data', (d) => (out += d.toString()));
          stream.stderr.on('data', () => {});
          stream.on('close', () => {
            const basePath = `/AgroTech_recordings/${patrol}/${recording}/`;
            const files = out.trim().split('\n').filter(Boolean).map(l => {
              const [path, size] = l.split('|');
              return { path, rel: path.replace(basePath, ''), size: parseInt(size) || 0 };
            });

            global.uploads[uploadId].files = files.map(f => f.rel);
            global.uploads[uploadId].total = files.length;
            global.uploads[uploadId].status = 'uploading';

            sshConn.sftp((err, sftp) => {
              if (err) { global.uploads[uploadId].status = 'error'; global.uploads[uploadId].errors.push(err.message); sshConn.end(); return; }

              let idx = 0;
              const uploadNext = () => {
                if (idx >= files.length) {
                  global.uploads[uploadId].status = 'done';
                  sftp.end();
                  sshConn.end();
                  return;
                }
                const f = files[idx];
                const s3Key = `${prefix || ''}${patrol}/${recording}/${f.rel}`;

                sftp.readFile(f.path, (err, data) => {
                  if (err) {
                    global.uploads[uploadId].errors.push(`${f.rel}: ${err.message}`);
                    global.uploads[uploadId].uploaded++;
                    idx++;
                    uploadNext();
                    return;
                  }
                  s3.send(new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: data }))
                    .then(() => { global.uploads[uploadId].uploaded++; idx++; uploadNext(); })
                    .catch((e) => { global.uploads[uploadId].errors.push(`${f.rel}: ${e.message}`); global.uploads[uploadId].uploaded++; idx++; uploadNext(); });
                });
              };
              uploadNext();
            });
          });
        });
      });
      sshConn.on('error', (err) => {
        global.uploads[uploadId] = { status: 'error', errors: [err.message], uploaded: 0, total: 0 };
      });
      sshConn.connect({ host, port: 22, username: user, password });
      json({ ok: true, message: `Upload started: ${uploadId}` });

    } else if (req.url === '/s3/status' && req.method === 'POST') {
      const { patrol, recording } = parsed;
      const uploadId = `${patrol}/${recording}`;
      const info = (global.uploads || {})[uploadId];
      json(info || { status: 'idle' });

    } else {
      json({ ok: true, sessions: Object.keys(sessions) });
    }
  });
});

server.listen(4500, () => console.log('SSH bridge listening on :4500'));
