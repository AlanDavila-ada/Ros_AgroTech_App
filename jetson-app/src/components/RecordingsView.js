import { useState, useEffect, useRef, useCallback } from 'react';
import ROSLIB from 'roslib';
import { apiExec, apiLaunch, apiStop, apiOutput, rosEnv } from '../api';
const sshExec = (host, cmd) => apiExec(cmd, host);

const TOPIC_MAP = {
  '/jetson/cam0/image_raw/compressed': '/playback/cam0/raw/compressed',
  '/jetson/cam1/image_raw/compressed': '/playback/cam1/raw/compressed',
  '/jetson/cam0/image_undistorted/compressed': '/playback/cam0/processed/compressed',
  '/jetson/cam1/image_undistorted/compressed': '/playback/cam1/processed/compressed',
};

const IMAGE_TYPES = ['sensor_msgs/msg/CompressedImage', 'sensor_msgs/msg/Image'];
const ROS_TYPE_MAP = {
  'sensor_msgs/msg/CompressedImage': 'sensor_msgs/CompressedImage',
  'sensor_msgs/msg/Image': 'sensor_msgs/Image',
  'nav_msgs/msg/Odometry': 'nav_msgs/Odometry',
  'sensor_msgs/msg/JointState': 'sensor_msgs/JointState',
  'sensor_msgs/msg/Imu': 'sensor_msgs/Imu',
  'std_msgs/msg/String': 'std_msgs/String',
  'geometry_msgs/msg/Twist': 'geometry_msgs/Twist',
};

/* ── Playback viewer ── */
const PlaybackViewer = ({ jetsonHost, active, onConnected, topics }) => {
  const [imgSrcs, setImgSrcs] = useState({});
  const [dataValues, setDataValues] = useState({});
  const urlRefs = useRef({});
  const rosRef = useRef(null);
  const subsRef = useRef([]);

  const topicEntries = Object.entries(topics || {}).filter(([, info]) => (info.frames || 0) > 0);
  const imageTopics = topicEntries.filter(([, info]) => IMAGE_TYPES.includes(info.type));
  const dataTopics = topicEntries.filter(([, info]) => !IMAGE_TYPES.includes(info.type));

  useEffect(() => {
    if (!active || topicEntries.length === 0) return;
    const ros = new ROSLIB.Ros({ url: `ws://${jetsonHost}:9090` });
    ros.on('error', () => {});
    rosRef.current = ros;

    ros.on('connection', () => {
      const subs = topicEntries.map(([origTopic, info]) => {
        const pbTopic = TOPIC_MAP[origTopic] || ('/playback' + origTopic);
        const rosType = ROS_TYPE_MAP[info.type] || info.type.replace('/msg/', '/');
        const isImage = IMAGE_TYPES.includes(info.type);
        const sub = new ROSLIB.Topic({ ros, name: pbTopic, messageType: rosType });
        sub.subscribe((msg) => {
          if (isImage && msg.data) {
            const raw = atob(msg.data);
            const arr = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
            if (urlRefs.current[origTopic]) URL.revokeObjectURL(urlRefs.current[origTopic]);
            urlRefs.current[origTopic] = URL.createObjectURL(new Blob([arr], { type: 'image/jpeg' }));
            setImgSrcs((prev) => ({ ...prev, [origTopic]: urlRefs.current[origTopic] }));
          } else {
            setDataValues((prev) => ({ ...prev, [origTopic]: msg }));
          }
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
      setImgSrcs({});
      setDataValues({});
    };
  }, [jetsonHost, active, topicEntries.length]);

  const shortName = (t) => t.split('/').filter(Boolean).slice(-2).join('/');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {imageTopics.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(imageTopics.length, 4)}, 1fr)`, gap: 10 }}>
          {imageTopics.map(([topic]) => (
            <div key={topic} style={cs.card}>
              <div style={cs.header}>{shortName(topic)}</div>
              {imgSrcs[topic] ? <img src={imgSrcs[topic]} alt={topic} style={cs.img} /> : <div style={cs.ph}>Waiting...</div>}
            </div>
          ))}
        </div>
      )}
      {dataTopics.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(dataTopics.length, 3)}, 1fr)`, gap: 10 }}>
          {dataTopics.map(([topic, info]) => (
            <div key={topic} style={cs.card}>
              <div style={cs.header}>{shortName(topic)} <span style={{ color: '#555', fontWeight: 400 }}>({info.type.split('/').pop()})</span></div>
              <pre style={cs.dataBox}>{dataValues[topic] ? JSON.stringify(dataValues[topic], null, 1) : 'Waiting...'}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Scan script: supports both old (patrol/rec) and new (company/device/patrol/rec) structures ── */
const SCAN_SCRIPT = `python3 -c "
import os,json
base='/AgroTech_recordings'
out=[]
def load_meta(d):
  for name in ['metadata.json','cameras_metadata.json','sensors_metadata.json']:
    fp=os.path.join(d,name)
    if os.path.isfile(fp):
      with open(fp) as f: return json.load(f)
  return None
def scan(d, parts):
  m=load_meta(d)
  if m:
    if len(parts)==4:
      out.append({'company':parts[0],'device':parts[1],'patrol':parts[2],'recording':parts[3],'meta':m})
    elif len(parts)==2:
      out.append({'company':'','device':'','patrol':parts[0],'recording':parts[1],'meta':m})
    return
  if len(parts)>=4: return
  try: entries=sorted(os.listdir(d))
  except: return
  for e in entries:
    ep=os.path.join(d,e)
    if os.path.isdir(ep): scan(ep, parts+[e])
scan(base,[])
print(json.dumps(out))
"`;

export const RecordingsView = ({ jetsonHost, domainId, rec }) => {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [playPct, setPlayPct] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const [fileTree, setFileTree] = useState(null);
  const [fileTreeLoading, setFileTreeLoading] = useState(false);
  const [highlightKey, setHighlightKey] = useState(null);
  const pollRef = useRef(null);
  const offsetRef = useRef(0);
  const prevActiveRef = useRef(false);

  const loadRecordings = useCallback(async () => {
    setLoading(true);
    try {
      const d = await sshExec(jetsonHost, SCAN_SCRIPT);
      if (d.ok && d.output) {
        try {
          const parsed = JSON.parse(d.output.trim());
          // Sort newest-first by start_time (ISO 8601 sorts lexicographically).
          parsed.sort((a, b) => (b.meta?.start_time || '').localeCompare(a.meta?.start_time || ''));
          setRecordings(parsed);
        } catch {}
      }
    } catch {}
    setLoading(false);
  }, [jetsonHost]);

  useEffect(() => { loadRecordings(); }, [loadRecordings]);

  // Auto-refresh on the falling edge of rec.active (a recording just finished).
  // Wait briefly for camera_node/mcap_recorder to flush metadata.json before scanning.
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    const isActive = !!rec?.active;
    prevActiveRef.current = isActive;
    if (wasActive && !isActive) {
      // Use lastIds — rec.ids is null once status flips to idle (camera_node drops `dir`).
      const ids = rec?.lastIds;
      const justFinished = ids ? `${ids.customer}/${ids.device}/${ids.patrol}/${ids.recording}` : null;
      const t = setTimeout(async () => {
        await loadRecordings();
        if (justFinished) {
          setHighlightKey(justFinished);
          setTimeout(() => setHighlightKey(null), 5000);
        }
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [rec?.active, rec?.lastIds, loadRecordings]);

  const recPath = (rec) => rec.company
    ? `${rec.company}/${rec.device}/${rec.patrol}/${rec.recording}`
    : `${rec.patrol}/${rec.recording}`;

  const recKey = (rec) => recPath(rec);

  const loadFileTree = async (rec) => {
    const key = recKey(rec);
    if (expanded === key) { setExpanded(null); setFileTree(null); return; }
    setExpanded(key);
    setFileTreeLoading(true);
    const rp = recPath(rec);
    try {
      const d = await sshExec(jetsonHost,
        `python3 -c "
import os,json
base='/AgroTech_recordings/${rp}'
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
    const rp = recPath(rec);
    try {
      const d = await sshExec(jetsonHost, `base64 /AgroTech_recordings/${rp}/${relPath}`);
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
    await new Promise((resolve) => { viewerReadyRef.current = resolve; });
    try {
      await apiLaunch('mcap_player', `${rosEnv(domainId)} && python3 /home/ada/mcap_player.py --path /AgroTech_recordings/${recPath(rec)} --speed ${speed}`, jetsonHost);
    } catch {}
    pollRef.current = setInterval(async () => {
      try {
        const d = await apiOutput('mcap_player', offsetRef.current);
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
    try { await apiStop('mcap_player', jetsonHost); } catch {}
    setPlaying(false);
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  // Group recordings by customer / device. Truncate UUIDs for readability.
  const shortId = (id) => !id ? '' : (id.length > 12 ? `${id.slice(0, 8)}…` : id);
  const grouped = {};
  recordings.forEach((r) => {
    const group = r.company
      ? `Customer ${shortId(r.company)} · Device ${shortId(r.device)}`
      : 'Legacy';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(r);
  });

  return (
    <main style={st.main}>
      <div style={st.header}>
        <span style={st.title}>Recordings</span>
        <button style={st.refreshBtn} onClick={loadRecordings} disabled={loading}>{loading ? '...' : '↻ Refresh'}</button>
      </div>

      {recordings.length === 0 && !loading && <div style={st.empty}>No recordings found in /AgroTech_recordings/</div>}

      {Object.entries(grouped).map(([group, recs]) => (
        <div key={group}>
          <div style={st.groupHeader}>{group}</div>
          <div style={st.list}>
            {recs.map((rec) => {
              const m = rec.meta;
              const key = recKey(rec);
              const active = selected && recKey(selected) === key;
              const totalFrames = Object.values(m.topics || {}).reduce((a, t) => a + (t.frames || 0), 0);
              const hasCamerasMcap = fileTree && expanded === key && fileTree.some(f => f.path === 'cameras.mcap');
              const isHighlighted = highlightKey === key;
              const cardBorder = isHighlighted ? '#00d26a' : (active ? '#6c5ce7' : '#1e1e2a');
              return (
                <div key={key} style={{ ...st.recCard, borderColor: cardBorder, boxShadow: isHighlighted ? '0 0 16px #00d26a44' : 'none', transition: 'all 0.3s' }}>
                  {isHighlighted && <div style={st.newBadge}>● JUST FINISHED</div>}
                  <div style={st.recHeader}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={st.recTitle} title={`${rec.patrol} / ${rec.recording}`}>{shortId(rec.patrol)} / {shortId(rec.recording)}</div>
                      <div style={st.recMeta}>{m.start_time} — {m.duration_sec}s — {totalFrames} frames</div>
                      {m.comment && <div style={st.recComment}>💬 {m.comment}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button style={st.browseBtn} onClick={() => loadFileTree(rec)}>
                        {expanded === key ? '📁 Hide' : '📁 Files'}
                      </button>
                      {active && playing
                        ? <button style={st.stopBtn} onClick={stopPlayback}>⏹ Stop</button>
                        : <button style={st.playBtn} onClick={() => startPlayback(rec)} disabled={playing}>▶ Play</button>
                      }
                    </div>
                  </div>
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

                  {/* File tree */}
                  {expanded === key && (
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
        </div>
      ))}

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

      {selected && playing && <PlaybackViewer jetsonHost={jetsonHost} active={playing} topics={selected.meta.topics} onConnected={() => { if (viewerReadyRef.current) { viewerReadyRef.current(); viewerReadyRef.current = null; } }} />}
    </main>
  );
};

const cs = {
  card: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 10, overflow: 'hidden' },
  header: { padding: '8px 12px', fontSize: 11, fontWeight: 600, borderBottom: '1px solid #1e1e2a', color: '#aaa' },
  img: { width: '100%', display: 'block' },
  ph: { padding: 30, textAlign: 'center', color: '#444', fontSize: 11 },
  dataBox: { margin: 0, padding: 10, fontSize: 10, color: '#8f8', fontFamily: "'JetBrains Mono', monospace", background: '#0a0a0f', maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
};

const st = {
  main: { flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: 700, color: '#e0e0e6' },
  refreshBtn: { padding: '6px 14px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#888', fontSize: 11, cursor: 'pointer', fontWeight: 600 },
  empty: { padding: 40, textAlign: 'center', color: '#555', fontSize: 13 },
  groupHeader: { fontSize: 12, fontWeight: 700, color: '#6c5ce7', letterSpacing: '0.5px', padding: '8px 0 4px', borderBottom: '1px solid #1e1e2a', marginBottom: 8 },
  list: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 },
  recCard: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, padding: 14, position: 'relative' },
  newBadge: { position: 'absolute', top: -8, right: 12, padding: '2px 10px', background: '#00d26a', color: '#0a0a0f', fontSize: 9, fontWeight: 800, letterSpacing: '1px', borderRadius: 4 },
  recComment: { marginTop: 4, fontSize: 11, color: '#aaa', fontStyle: 'italic' },
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
