import { useState, useEffect, useRef, useCallback } from 'react';

const SSH_URL = 'http://localhost:4500';
const CREDS_KEY = 'agrotech_aws_creds';

const loadCreds = () => {
  try { return JSON.parse(localStorage.getItem(CREDS_KEY)) || {}; } catch { return {}; }
};

export const JetsonUpload = ({ jetsonHost }) => {
  const [creds, setCreds] = useState(() => loadCreds());
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploads, setUploads] = useState({}); // key: patrol/recording -> status obj
  const pollRef = useRef({});

  const saveCreds = (c) => { setCreds(c); localStorage.setItem(CREDS_KEY, JSON.stringify(c)); };
  const updateCred = (k, v) => saveCreds({ ...creds, [k]: v });

  const configured = creds.bucket && creds.region && creds.accessKeyId && creds.secretAccessKey;

  const loadRecordings = useCallback(async () => {
    if (!jetsonHost) return;
    setLoading(true);
    try {
      const r = await fetch(`${SSH_URL}/ssh/exec`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: jetsonHost, user: 'hec', password: 'h3ll0',
          command: `python3 -c "
import os,json
base='/AgroTech_recordings'
out=[]
for p in sorted(os.listdir(base)):
 pp=os.path.join(base,p)
 if not os.path.isdir(pp): continue
 for r in sorted(os.listdir(pp)):
  mf=os.path.join(pp,r,'metadata.json')
  if os.path.isfile(mf):
   with open(mf) as f: m=json.load(f)
   total=sum(t.get('frames',0) for t in m.get('topics',{}).values())
   out.append({'patrol':p,'recording':r,'duration':m.get('duration_sec',0),'frames':total,'date':m.get('start_time','')})
print(json.dumps(out))
"` }),
      });
      const d = await r.json();
      if (d.ok && d.output) {
        try { setRecordings(JSON.parse(d.output.trim())); } catch {}
      }
    } catch {}
    setLoading(false);
  }, [jetsonHost]);

  useEffect(() => { loadRecordings(); }, [loadRecordings]);

  const startUpload = async (rec) => {
    const key = `${rec.patrol}/${rec.recording}`;
    setUploads(prev => ({ ...prev, [key]: { status: 'starting' } }));
    try {
      await fetch(`${SSH_URL}/s3/upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: jetsonHost, user: 'hec', password: 'h3ll0',
          patrol: rec.patrol, recording: rec.recording,
          bucket: creds.bucket, prefix: creds.prefix || '', region: creds.region,
          accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey,
        }),
      });
      // Poll status
      pollRef.current[key] = setInterval(async () => {
        try {
          const r = await fetch(`${SSH_URL}/s3/status`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patrol: rec.patrol, recording: rec.recording }),
          });
          const info = await r.json();
          setUploads(prev => ({ ...prev, [key]: info }));
          if (info.status === 'done' || info.status === 'error') {
            clearInterval(pollRef.current[key]);
          }
        } catch {}
      }, 1000);
    } catch (e) {
      setUploads(prev => ({ ...prev, [key]: { status: 'error', errors: [e.message] } }));
    }
  };

  useEffect(() => () => Object.values(pollRef.current).forEach(clearInterval), []);

  return (
    <div style={st.container}>
      {/* AWS Config */}
      <div style={st.section}>
        <div style={st.sectionTitle}>☁️ AWS S3 Configuration</div>
        <div style={st.form}>
          <div style={st.row}>
            <div style={st.field}>
              <label style={st.label}>Bucket *</label>
              <input style={st.input} placeholder="my-agrotech-bucket" value={creds.bucket || ''} onChange={e => updateCred('bucket', e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Region *</label>
              <input style={st.input} placeholder="us-east-1" value={creds.region || ''} onChange={e => updateCred('region', e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Prefix</label>
              <input style={st.input} placeholder="recordings/" value={creds.prefix || ''} onChange={e => updateCred('prefix', e.target.value)} />
            </div>
          </div>
          <div style={st.row}>
            <div style={st.field}>
              <label style={st.label}>Access Key ID *</label>
              <input style={st.input} placeholder="AKIA..." value={creds.accessKeyId || ''} onChange={e => updateCred('accessKeyId', e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Secret Access Key *</label>
              <input style={st.input} type="password" placeholder="••••••••" value={creds.secretAccessKey || ''} onChange={e => updateCred('secretAccessKey', e.target.value)} />
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>Credentials are saved in localStorage. S3 path: s3://{creds.bucket || '...'}/{creds.prefix || ''}{'{patrol}/{recording}/'}</div>
        </div>
      </div>

      {/* Recordings to upload */}
      <div style={st.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={st.sectionTitle}>Recordings</div>
          <button style={st.refreshBtn} onClick={loadRecordings} disabled={loading}>{loading ? '...' : '↻ Refresh'}</button>
        </div>
        {recordings.length === 0 && <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 20 }}>No recordings found</div>}
        {recordings.map(rec => {
          const key = `${rec.patrol}/${rec.recording}`;
          const u = uploads[key];
          const pct = u && u.total > 0 ? Math.round((u.uploaded / u.total) * 100) : 0;
          return (
            <div key={key} style={st.recCard}>
              <div style={st.recHeader}>
                <div>
                  <div style={st.recTitle}>{rec.patrol} / {rec.recording}</div>
                  <div style={st.recMeta}>{rec.date} — {rec.duration}s — {rec.frames} frames</div>
                </div>
                <div>
                  {u?.status === 'uploading' ? (
                    <span style={st.uploadingBadge}>⬆ {u.uploaded}/{u.total} ({pct}%)</span>
                  ) : u?.status === 'done' ? (
                    <span style={st.doneBadge}>✓ Uploaded</span>
                  ) : u?.status === 'error' ? (
                    <span style={st.errorBadge}>✕ Error</span>
                  ) : (
                    <button style={st.uploadBtn} onClick={() => startUpload(rec)} disabled={!configured || (u && u.status === 'uploading')}>
                      ⬆ Upload
                    </button>
                  )}
                </div>
              </div>
              {u?.status === 'uploading' && (
                <div style={st.progressWrap}>
                  <div style={{ ...st.progressBar, width: `${pct}%` }} />
                </div>
              )}
              {u?.errors?.length > 0 && (
                <div style={st.errorList}>{u.errors.map((e, i) => <div key={i}>{e}</div>)}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const st = {
  container: { display: 'flex', flexDirection: 'column', gap: 16 },
  section: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, padding: 16 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#e0e0e6', marginBottom: 12 },
  form: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  field: { flex: 1, minWidth: 140 },
  label: { display: 'block', fontSize: 10, color: '#666', marginBottom: 3, fontWeight: 600 },
  input: { width: '100%', padding: '7px 10px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, color: '#ccc', fontSize: 12, outline: 'none', boxSizing: 'border-box' },
  refreshBtn: { padding: '5px 12px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, color: '#888', fontSize: 11, cursor: 'pointer', fontWeight: 600 },
  recCard: { background: '#0a0a0f', border: '1px solid #1e1e2a', borderRadius: 10, padding: 12, marginBottom: 8 },
  recHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  recTitle: { fontSize: 13, fontWeight: 700, color: '#e0e0e6' },
  recMeta: { fontSize: 11, color: '#666', marginTop: 2 },
  uploadBtn: { padding: '6px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#6c5ce712', border: '1px solid #6c5ce733', color: '#6c5ce7' },
  uploadingBadge: { fontSize: 11, color: '#ffa502', fontWeight: 700 },
  doneBadge: { fontSize: 11, color: '#00d26a', fontWeight: 700 },
  errorBadge: { fontSize: 11, color: '#ff4757', fontWeight: 700 },
  progressWrap: { marginTop: 8, height: 4, background: '#1a1a24', borderRadius: 2, overflow: 'hidden' },
  progressBar: { height: '100%', background: '#6c5ce7', borderRadius: 2, transition: 'width 0.3s' },
  errorList: { marginTop: 6, padding: 8, background: '#ff475708', borderRadius: 6, fontSize: 10, color: '#ff4757', fontFamily: "'JetBrains Mono', monospace", maxHeight: 60, overflow: 'auto' },
};
