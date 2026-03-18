import { useState, useEffect, useRef, useCallback } from 'react';
import ROSLIB from 'roslib';

const SSH_URL = 'http://localhost:4500';
const sshExec = async (host, cmd) => {
  const r = await fetch(`${SSH_URL}/ssh/exec`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, user: 'hec', password: 'h3ll0', command: cmd }),
  });
  return r.json();
};

const PLAYBACK_TOPICS = [
  { key: 'cam0_raw', topic: '/playback/cam0/raw/compressed', label: 'Cam0 Raw' },
  { key: 'cam0_proc', topic: '/playback/cam0/processed/compressed', label: 'Cam0 Processed' },
  { key: 'cam1_raw', topic: '/playback/cam1/raw/compressed', label: 'Cam1 Raw' },
  { key: 'cam1_proc', topic: '/playback/cam1/processed/compressed', label: 'Cam1 Processed' },
];

/* ── Playback viewer (single ROS connection, 4 subs) ── */
const PlaybackViewer = ({ jetsonHost, active, onConnected }) => {
  const [srcs, setSrcs] = useState({});
  const urlRefs = useRef({});
  const rosRef = useRef(null);
  const subsRef = useRef([]);

  useEffect(() => {
    if (!active) return;
    const ros = new ROSLIB.Ros({ url: `ws://${jetsonHost}:9090` });
    ros.on('error', () => {});
    rosRef.current = ros;

    ros.on('connection', () => {
      const subs = PLAYBACK_TOPICS.map(({ key, topic }) => {
        const sub = new ROSLIB.Topic({ ros, name: topic, messageType: 'sensor_msgs/CompressedImage' });
        sub.subscribe((msg) => {
          const raw = atob(msg.data);
          const arr = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
          if (urlRefs.current[key]) URL.revokeObjectURL(urlRefs.current[key]);
          urlRefs.current[key] = URL.createObjectURL(new Blob([arr], { type: 'image/jpeg' }));
          setSrcs((prev) => ({ ...prev, [key]: urlRefs.current[key] }));
        });
        return sub;
      });
      subsRef.current = subs;
      if (onConnected) onConnected();
    });

    return () => {
      subsRef.current.forEach((s) => s.unsubscribe());
      Object.values(urlRefs.current).forEach((u) => URL.revokeObjectURL(u));
      urlRefs.current = {};
      if (rosRef.current) rosRef.current.close();
      setSrcs({});
    };
  }, [jetsonHost, active]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[['cam0', 'Camera 0', 'cam0_raw', 'cam0_proc'], ['cam1', 'Camera 1', 'cam1_raw', 'cam1_proc']].map(([id, title, rawK, procK]) => (
        <div key={id}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e6', marginBottom: 6 }}>{title}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[[rawK, 'Raw'], [procK, 'Processed']].map(([k, lbl]) => (
              <div key={k} style={cs.card}>
                <div style={cs.header}>{lbl}</div>
                {srcs[k] ? <img src={srcs[k]} alt={lbl} style={cs.img} /> : <div style={cs.ph}>Waiting...</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export const RecordingsView = ({ jetsonHost }) => {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [playPct, setPlayPct] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [expanded, setExpanded] = useState(null); // patrol/recording key for file tree
  const [fileTree, setFileTree] = useState(null);
  const [fileTreeLoading, setFileTreeLoading] = useState(false);
  const pollRef = useRef(null);
  const offsetRef = useRef(0);

  const loadRecordings = useCallback(async () => {
    setLoading(true);
    try {
      const d = await sshExec(jetsonHost,
        `python3 -c "
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
   out.append({'patrol':p,'recording':r,'meta':m})
print(json.dumps(out))
"`
      );
      if (d.ok && d.output) {
        try { setRecordings(JSON.parse(d.output.trim())); } catch {}
      }
    } catch {}
    setLoading(false);
  }, [jetsonHost]);

  useEffect(() => { loadRecordings(); }, [loadRecordings]);

  const loadFileTree = async (rec) => {
    const key = `${rec.patrol}/${rec.recording}`;
    if (expanded === key) { setExpanded(null); setFileTree(null); return; }
    setExpanded(key);
    setFileTreeLoading(true);
    try {
      const d = await sshExec(jetsonHost,
        `python3 -c "
import os,json
base='/AgroTech_recordings/${rec.patrol}/${rec.recording}'
tree=[]
for root,dirs,files in os.walk(base):
 for f in sorted(files):
  fp=os.path.join(root,f)
  rel=os.path.relpath(fp,base)
  sz=os.path.getsize(fp)
  tree.append({'path':rel,'size':sz})
print(json.dumps(tree))
"`
      );
      if (d.ok && d.output) {
        try { setFileTree(JSON.parse(d.output.trim())); } catch { setFileTree([]); }
      }
    } catch { setFileTree([]); }
    setFileTreeLoading(false);
  };

  const downloadFile = async (rec, relPath) => {
    try {
      const d = await sshExec(jetsonHost,
        `base64 /AgroTech_recordings/${rec.patrol}/${rec.recording}/${relPath}`
      );
      if (d.ok && d.output) {
        const raw = atob(d.output.trim());
        const arr = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        const blob = new Blob([arr]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = relPath.split('/').pop();
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {}
  };

  const fmtSize = (b) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`;

  const viewerReadyRef = useRef(null);

  const startPlayback = async (rec) => {
    setSelected(rec);
    setPlaying(true);
    setPlayPct(0);
    offsetRef.current = 0;
    // Wait for PlaybackViewer ROSLIB to connect
    await new Promise((resolve) => { viewerReadyRef.current = resolve; });
    try {
      await fetch(`${SSH_URL}/ssh/launch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'mcap_player', host: jetsonHost, user: 'hec', password: 'h3ll0',
          command: `source /opt/ros/humble/setup.bash && python3 /home/hec/mcap_player.py --patrol "${rec.patrol}" --recording "${rec.recording}" --speed ${speed}`,
        }),
      });
    } catch {}
    // Poll progress
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${SSH_URL}/ssh/output`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'mcap_player', since: offsetRef.current }),
        });
        const d = await r.json();
        if (d.lines) {
          offsetRef.current = d.offset;
          for (const l of d.lines.split('\n').filter(Boolean)) {
            try {
              const p = JSON.parse(l);
              if (p.pct !== undefined) setPlayPct(p.pct);
              if (p.stage === 'done') { clearInterval(pollRef.current); setPlayPct(100); }
            } catch {}
          }
        }
      } catch {}
    }, 500);
  };

  const stopPlayback = async () => {
    clearInterval(pollRef.current);
    try { await fetch(`${SSH_URL}/ssh/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'mcap_player', host: jetsonHost, user: 'hec', password: 'h3ll0', command: 'python3 /home/hec/mcap_player.py' }) }); } catch {}
    setPlaying(false);
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  return (
    <main style={st.main}>
      <div style={st.header}>
        <span style={st.title}>Recordings</span>
        <button style={st.refreshBtn} onClick={loadRecordings} disabled={loading}>{loading ? '...' : '↻ Refresh'}</button>
      </div>

      {/* Recording list */}
      {recordings.length === 0 && !loading && <div style={st.empty}>No recordings found in /AgroTech_recordings/</div>}
      <div style={st.list}>
        {recordings.map((rec) => {
          const m = rec.meta;
          const active = selected?.patrol === rec.patrol && selected?.recording === rec.recording;
          const totalFrames = Object.values(m.topics || {}).reduce((a, t) => a + (t.frames || 0), 0);
          return (
            <div key={`${rec.patrol}/${rec.recording}`} style={{ ...st.recCard, borderColor: active ? '#6c5ce7' : '#1e1e2a' }}>
              <div style={st.recHeader}>
                <div>
                  <div style={st.recTitle}>{rec.patrol} / {rec.recording}</div>
                  <div style={st.recMeta}>{m.start_time} — {m.duration_sec}s — {totalFrames} frames</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button style={st.browseBtn} onClick={() => loadFileTree(rec)}>
                    {expanded === `${rec.patrol}/${rec.recording}` ? '📁 Hide' : '📁 Files'}
                  </button>
                  {active && playing
                    ? <button style={st.stopBtn} onClick={stopPlayback}>⏹ Stop</button>
                    : <button style={st.playBtn} onClick={() => startPlayback(rec)} disabled={playing}>▶ Play</button>
                  }
                </div>
              </div>
              {/* Topics */}
              <div style={st.topicList}>
                {Object.entries(m.topics || {}).map(([t, info]) => (
                  <span key={t} style={st.topicTag}>{t.split('/').pop()} ({info.frames})</span>
                ))}
              </div>
              {m.calibration_profile && (
                <div style={{ marginTop: 6 }}>
                  {Object.entries(m.calibration_profile).map(([cid, c]) => (
                    <span key={cid} style={{ ...st.topicTag, borderColor: '#6c5ce733', color: '#6c5ce7' }}>📐 {cid}: fx={c.fx} fy={c.fy}</span>
                  ))}
                </div>
              )}
              {m.pose_match_id && <div style={st.recMeta}>Pose match: {m.pose_match_id}</div>}

              {/* File tree */}
              {expanded === `${rec.patrol}/${rec.recording}` && (
                <div style={st.fileTree}>
                  {fileTreeLoading ? <div style={{ color: '#555', fontSize: 11 }}>Loading...</div> :
                   !fileTree || fileTree.length === 0 ? <div style={{ color: '#555', fontSize: 11 }}>No files</div> :
                   fileTree.map((f) => (
                    <div key={f.path} style={st.fileRow}>
                      <span style={st.filePath}>{f.path}</span>
                      <span style={st.fileSize}>{fmtSize(f.size)}</span>
                      <button style={st.dlBtn} onClick={() => downloadFile(rec, f.path)}>↓</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Speed control */}
      <div style={st.controls}>
        <span style={{ fontSize: 11, color: '#888' }}>Speed:</span>
        {[0.5, 1, 2, 4].map((s) => (
          <button key={s} onClick={() => setSpeed(s)} disabled={playing}
            style={{ ...st.speedBtn, borderColor: speed === s ? '#6c5ce7' : '#2a2a3a', color: speed === s ? '#6c5ce7' : '#888' }}>
            {s}x
          </button>
        ))}
      </div>

      {/* Progress bar */}
      {playing && (
        <div style={st.progressWrap}>
          <div style={{ ...st.progressBar, width: `${playPct}%` }} />
          <span style={st.progressText}>{playPct}%</span>
        </div>
      )}

      {/* Playback streams */}
      {selected && playing && <PlaybackViewer jetsonHost={jetsonHost} active={playing} onConnected={() => { if (viewerReadyRef.current) { viewerReadyRef.current(); viewerReadyRef.current = null; } }} />}
    </main>
  );
};

const cs = {
  card: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 10, overflow: 'hidden' },
  header: { padding: '8px 12px', fontSize: 11, fontWeight: 600, borderBottom: '1px solid #1e1e2a', color: '#aaa' },
  img: { width: '100%', display: 'block' },
  ph: { padding: 30, textAlign: 'center', color: '#444', fontSize: 11 },
};

const st = {
  main: { flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: 700, color: '#e0e0e6' },
  refreshBtn: { padding: '6px 14px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#888', fontSize: 11, cursor: 'pointer', fontWeight: 600 },
  empty: { padding: 40, textAlign: 'center', color: '#555', fontSize: 13 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  recCard: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, padding: 14 },
  recHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  recTitle: { fontSize: 14, fontWeight: 700, color: '#e0e0e6' },
  recMeta: { fontSize: 11, color: '#666', marginTop: 2 },
  topicList: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 },
  topicTag: { padding: '3px 8px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 10, color: '#888' },
  playBtn: { padding: '6px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#00d26a15', border: '1px solid #00d26a44', color: '#00d26a' },
  stopBtn: { padding: '6px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#ff475715', border: '1px solid #ff475744', color: '#ff4757' },
  browseBtn: { padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: '#1a1a24', border: '1px solid #2a2a3a', color: '#888' },
  fileTree: { marginTop: 10, padding: 10, background: '#0a0a0f', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' },
  fileRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
  filePath: { flex: 1, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fileSize: { color: '#555', fontSize: 10, flexShrink: 0 },
  dlBtn: { width: 22, height: 22, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, cursor: 'pointer', background: '#6c5ce712', border: '1px solid #6c5ce733', color: '#6c5ce7', flexShrink: 0 },
  controls: { display: 'flex', gap: 6, alignItems: 'center' },
  speedBtn: { padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: '#1a1a24', border: '1px solid #2a2a3a' },
  progressWrap: { position: 'relative', height: 20, background: '#1a1a24', borderRadius: 8, overflow: 'hidden', border: '1px solid #1e1e2a' },
  progressBar: { height: '100%', background: '#6c5ce744', transition: 'width 0.3s' },
  progressText: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#aaa' },
};
