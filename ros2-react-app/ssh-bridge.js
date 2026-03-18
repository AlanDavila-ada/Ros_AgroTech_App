const http = require('http');
const { Client } = require('ssh2');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));

const sessions = {}; // keyed by id

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
      // Check bridge session
      if (sessions[id] && !sessions[id].done) {
        json({ ok: false, error: `Session "${id}" already running. Stop first.` }); return;
      }
      // Check if process is already running on remote
      const procName = command.split('&&').pop().trim().split(/\s+/).slice(0, 2).join(' ');
      const chkConn = new Client();
      chkConn.on('ready', () => {
        chkConn.exec(`ps aux | grep "${procName}" | grep -v grep | grep -v pgrep | grep -v pkill > /dev/null 2>&1 && echo ALIVE || echo DEAD`, (err, stream) => {
          let out = '';
          if (err) { chkConn.end(); doLaunch(); return; }
          stream.on('data', (d) => (out += d.toString()));
          stream.on('close', () => {
            chkConn.end();
            if (out.trim() === 'ALIVE') {
              json({ ok: false, error: `Process already running on remote. Stop first.` });
            } else {
              // Clean stale session if exists
              if (sessions[id]) delete sessions[id];
              doLaunch();
            }
          });
        });
      });
      chkConn.on('error', () => doLaunch());
      chkConn.connect({ host, port: 22, username: user, password });

      function doLaunch() {
        const conn = new Client();
        conn.on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) { json({ ok: false, error: err.message }); conn.end(); return; }
            const output = [];
            sessions[id] = { conn, stream, output, done: false, host, user, password, command };
            stream.on('data', (d) => output.push(d.toString()));
            stream.stderr.on('data', (d) => output.push(d.toString()));
            stream.on('close', () => { if (sessions[id]) sessions[id].done = true; });
            json({ ok: true, message: `[${id}] launched on ${user}@${host}` });
          });
        });
        conn.on('error', (err) => { json({ ok: false, error: err.message }); delete sessions[id]; });
        conn.connect({ host, port: 22, username: user, password, keepaliveInterval: 10000, keepaliveCountMax: 10 });
      }

    } else if (req.url === '/ssh/stop' && req.method === 'POST') {
      const { id, host, user, password, command } = JSON.parse(body);
      const s = sessions[id];
      if (s) {
        try { if (s.stream) s.stream.signal('INT'); } catch {}
        setTimeout(() => {
          try { if (s.stream) s.stream.signal('KILL'); } catch {}
          setTimeout(() => {
            try { if (s.conn) s.conn.end(); } catch {}
            delete sessions[id];
          }, 500);
        }, 1000);
      }
      // Always pkill on remote (covers orphaned processes)
      const cmd = (s && s.command) || command;
      const h = (s && s.host) || host;
      const u = (s && s.user) || user;
      const p = (s && s.password) || password;
      if (cmd && h && u && p) {
        const procName = cmd.split('&&').pop().trim().split(/\s+/).slice(0, 2).join(' ');
        const killConn = new Client();
        killConn.on('ready', () => {
          killConn.exec(`ps aux | grep "${procName}" | grep -v grep | grep -v pkill | awk '{print $2}' | xargs -r kill -9`, () => { killConn.end(); });
        });
        killConn.on('error', () => {});
        killConn.connect({ host: h, port: 22, username: u, password: p });
      }
      if (!s) delete sessions[id];
      json({ ok: true, message: `[${id}] stopped` });

    } else if (req.url === '/ssh/output' && req.method === 'POST') {
      const { id, since } = JSON.parse(body);
      const s = sessions[id];
      if (!s) { json({ ok: true, lines: [], done: true }); return; }
      const all = s.output.join('');
      const fresh = since ? all.slice(since) : all;
      json({ ok: true, lines: fresh, offset: all.length, done: s.done });

    } else if (req.url === '/ssh/exec' && req.method === 'POST') {
      const { host, user, password, command } = JSON.parse(body);
      const conn = new Client();
      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) { json({ ok: false, error: err.message }); conn.end(); return; }
          let out = '';
          stream.on('data', (d) => (out += d.toString()));
          stream.stderr.on('data', (d) => (out += d.toString()));
          stream.on('close', () => { conn.end(); json({ ok: true, output: out }); });
        });
      });
      conn.on('error', (err) => json({ ok: false, error: err.message }));
      conn.connect({ host, port: 22, username: user, password });

    } else if (req.url === '/s3/upload' && req.method === 'POST') {
      const { host, user, password, patrol, recording, bucket, prefix, region, accessKeyId, secretAccessKey } = JSON.parse(body);
      const uploadId = `${patrol}/${recording}`;

      // Store upload progress
      if (!global.uploads) global.uploads = {};
      global.uploads[uploadId] = { status: 'listing', files: [], uploaded: 0, total: 0, errors: [] };

      const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
      const sshConn = new Client();

      sshConn.on('ready', () => {
        // List all files in the recording
        sshConn.exec(`find /AgroTech_recordings/${patrol}/${recording} -type f -exec stat --format='%n|%s' {} \\;`, (err, stream) => {
          if (err) { json({ ok: false, error: err.message }); sshConn.end(); return; }
          let out = '';
          stream.on('data', (d) => (out += d.toString()));
          stream.stderr.on('data', (d) => {});
          stream.on('close', () => {
            const basePath = `/AgroTech_recordings/${patrol}/${recording}/`;
            const files = out.trim().split('\n').filter(Boolean).map(l => {
              const [path, size] = l.split('|');
              return { path, rel: path.replace(basePath, ''), size: parseInt(size) || 0 };
            });

            global.uploads[uploadId].files = files.map(f => f.rel);
            global.uploads[uploadId].total = files.length;
            global.uploads[uploadId].status = 'uploading';

            // Upload files sequentially via SFTP
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
                    .then(() => {
                      global.uploads[uploadId].uploaded++;
                      idx++;
                      uploadNext();
                    })
                    .catch((e) => {
                      global.uploads[uploadId].errors.push(`${f.rel}: ${e.message}`);
                      global.uploads[uploadId].uploaded++;
                      idx++;
                      uploadNext();
                    });
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
