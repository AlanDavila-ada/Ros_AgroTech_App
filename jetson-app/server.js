const http = require('http');
const { exec, spawn } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));

const sessions = {};

const ROS_ENV = 'source /opt/ros/humble/setup.bash && source ~/ros2_ws/install/setup.bash 2>/dev/null && export ROS_DOMAIN_ID=42 && export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp && export CYCLONEDDS_URI=file://$HOME/cyclonedds.xml';

const localRun = (command) => new Promise((resolve, reject) => {
  exec(command, { shell: '/bin/bash', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err && !stdout) return reject(err);
    resolve(stdout + stderr);
  });
});

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
      localRun(`tmux has-session -t ${id} 2>/dev/null && echo ALIVE || echo DEAD`)
        .then((out) => {
          if (out.trim() === 'ALIVE') {
            json({ ok: false, error: `Session "${id}" already running. Stop first.` });
            return;
          }
          const logFile = `/tmp/agrotech_${id}.log`;
          const escaped = command.replace(/"/g, '\\"');
          const tmuxCmd = `rm -f ${logFile} && tmux new-session -d -s ${id} "${escaped}" && tmux pipe-pane -t ${id} 'cat >> ${logFile}'`;
          return localRun(tmuxCmd).then(() => {
            sessions[id] = { command, logFile };
            json({ ok: true, message: `[${id}] launched` });
          });
        })
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (url === '/api/stop' && req.method === 'POST') {
      const { id } = parsed;
      const s = sessions[id] || {};
      const logFile = s.logFile || `/tmp/agrotech_${id}.log`;
      localRun(`tmux send-keys -t ${id} C-c 2>/dev/null; sleep 3; tmux kill-session -t ${id} 2>/dev/null; rm -f ${logFile}; echo DONE`)
        .then(() => { delete sessions[id]; json({ ok: true, message: `[${id}] stopped` }); })
        .catch(() => { delete sessions[id]; json({ ok: true, message: `[${id}] stopped (force)` }); });

    } else if (url === '/api/output' && req.method === 'POST') {
      const { id, since } = parsed;
      const s = sessions[id];
      if (!s) { json({ ok: true, lines: '', offset: 0, done: true }); return; }
      const logFile = s.logFile || `/tmp/agrotech_${id}.log`;
      localRun(`tmux has-session -t ${id} 2>/dev/null && echo __ALIVE__ || echo __DEAD__; cat ${logFile} 2>/dev/null`)
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
server.listen(PORT, '0.0.0.0', () => console.log(`AgroTech bridge listening on :${PORT}`));
