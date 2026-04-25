const http = require('http');
const { Client } = require('ssh2');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));

const sessions = {}; // track launched session metadata

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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

    if (req.url === '/ssh/launch' && req.method === 'POST') {
      const { id, host, user, password, command } = JSON.parse(body);

      // Check if tmux session already exists
      sshRun(host, user, password, `tmux has-session -t ${id} 2>/dev/null && echo ALIVE || echo DEAD`)
        .then((out) => {
          if (out.trim() === 'ALIVE') {
            json({ ok: false, error: `Session "${id}" already running. Stop first.` });
            return;
          }
          // Launch in tmux session with log file
          const logFile = `/tmp/agrotech_${id}.log`;
          const escaped = command.replace(/"/g, '\\"');
          const tmuxCmd = `rm -f ${logFile} && tmux new-session -d -s ${id} "${escaped}"` +
            ` && tmux pipe-pane -t ${id} 'cat >> ${logFile}'`;
          return sshRun(host, user, password, tmuxCmd).then(() => {
            sessions[id] = { host, user, password, command, logFile };
            json({ ok: true, message: `[${id}] launched on ${user}@${host}` });
          });
        })
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (req.url === '/ssh/stop' && req.method === 'POST') {
      const { id, host, user, password } = JSON.parse(body);
      const s = sessions[id] || {};
      const h = s.host || host;
      const u = s.user || user;
      const p = s.password || password;

      if (!h || !u || !p) { json({ ok: true, message: `[${id}] no session info` }); return; }

      // Send C-c (SIGINT), wait 3s, then kill session if still alive
      const logFile = s.logFile || `/tmp/agrotech_${id}.log`;
      sshRun(h, u, p,
        `tmux send-keys -t ${id} C-c 2>/dev/null; sleep 3; tmux kill-session -t ${id} 2>/dev/null; rm -f ${logFile}; echo DONE`
      )
        .then(() => { delete sessions[id]; json({ ok: true, message: `[${id}] stopped` }); })
        .catch(() => { delete sessions[id]; json({ ok: true, message: `[${id}] stopped (force)` }); });

    } else if (req.url === '/ssh/output' && req.method === 'POST') {
      const { id, since } = JSON.parse(body);
      const s = sessions[id];
      if (!s) { json({ ok: true, lines: '', offset: 0, done: true }); return; }

      // Check if session is alive + read log file
      const logFile = s.logFile || `/tmp/agrotech_${id}.log`;
      sshRun(s.host, s.user, s.password,
        `tmux has-session -t ${id} 2>/dev/null && echo __ALIVE__ || echo __DEAD__; cat ${logFile} 2>/dev/null`
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
      const { host, user, password, command } = JSON.parse(body);
      sshRun(host, user, password, command)
        .then((out) => json({ ok: true, output: out }))
        .catch((err) => json({ ok: false, error: err.message }));

    } else if (req.url === '/s3/upload' && req.method === 'POST') {
      const { host, user, password, patrol, recording, bucket, prefix, region, accessKeyId, secretAccessKey } = JSON.parse(body);
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
      const { patrol, recording } = JSON.parse(body);
      const uploadId = `${patrol}/${recording}`;
      const info = (global.uploads || {})[uploadId];
      json(info || { status: 'idle' });

    } else {
      json({ ok: true, sessions: Object.keys(sessions) });
    }
  });
});

server.listen(4500, () => console.log('SSH bridge listening on :4500'));
