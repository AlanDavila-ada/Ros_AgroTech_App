import { useState, useEffect, useRef, useCallback } from 'react';
import ROSLIB from 'roslib';
import { apiExec, apiLaunch, apiStop, apiOutput, rosEnv } from '../api';
const sshExec = (host, cmd, domainId) => apiExec(`${rosEnv(domainId)} && ${cmd}`, host);

/* ── Single camera stream (same pattern as JetsonView's ImageStream) ── */
const CalibStream = ({ ros, topic, label, done, calibrating }) => {
  const [src, setSrc] = useState(null);
  const urlRef = useRef(null);

  useEffect(() => {
    if (!ros || done) return;
    const sub = new ROSLIB.Topic({ ros, name: topic, messageType: 'sensor_msgs/CompressedImage' });
    sub.subscribe((msg) => {
      const raw = atob(msg.data);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(new Blob([arr], { type: 'image/jpeg' }));
      setSrc(urlRef.current);
    });
    return () => { sub.unsubscribe(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [ros, topic, done]);

  return (
    <div style={{ background: '#0a0a0f', borderRadius: 8, overflow: 'hidden', border: `1px solid ${done ? '#00d26a' : '#1e1e2a'}` }}>
      <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, borderBottom: '1px solid #1e1e2a' }}>{label}</div>
      {done
        ? <div style={{ padding: 40, textAlign: 'center', color: '#00d26a', fontSize: 16, fontWeight: 700 }}>
            ✓ Captura completa{calibrating ? <div style={{ fontSize: 12, color: '#ffa502', marginTop: 8, fontWeight: 400 }}>⏳ Calculando intrínsecos...</div> : null}
          </div>
        : src
          ? <img src={src} alt={label} style={{ width: '100%', display: 'block' }} />
          : <div style={{ padding: 30, textAlign: 'center', color: '#444', fontSize: 11 }}>Waiting for frames...</div>
      }
    </div>
  );
};

/* ── Calibration live preview (reuses parent ROS connection) ── */
const CalibPreview = ({ camIds, jetsonHost, progress, target, calibrating, ros }) => {
  const [localRos, setLocalRos] = useState(null);

  useEffect(() => {
    if (ros) { setLocalRos(ros); return; }
    const r = new ROSLIB.Ros({ url: `ws://${jetsonHost}:9090` });
    r.on('error', () => {});
    r.on('connection', () => setLocalRos(r));
    return () => r.close();
  }, [ros, jetsonHost]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: camIds.length > 1 ? '1fr 1fr' : '1fr', gap: 8, marginTop: 8 }}>
      {camIds.map((id) => (
        <CalibStream
          key={id}
          ros={localRos}
          topic={`/calibration/cam${id}/preview/compressed`}
          label={`cam${id} preview`}
          done={(progress[id]?.saved || 0) >= target}
          calibrating={calibrating}
        />
      ))}
    </div>
  );
};

export const CalibrationPanel = ({ jetsonHost, onProfileActivated, domainId }) => {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState('profiles'); // 'profiles' | 'new'
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);

  // New calibration state
  const [target, setTarget] = useState(30);
  const [camera, setCamera] = useState('both');
  const [camType, setCamType] = useState('normal');
  const [profileName, setProfileName] = useState('');
  const [description, setDescription] = useState('');
  const [running, setRunning] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState({});
  const [result, setResult] = useState(null);
  const offsetRef = useRef(0);
  const pollRef = useRef(null);
  const logsEndRef = useRef(null);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const d = await sshExec(jetsonHost, 'python3 /home/ada/calibrate_headless.py --list-profiles', domainId);
      if (d.ok && d.output) {
        const lines = d.output.trim().split('\n');
        for (const l of lines) {
          try {
            const p = JSON.parse(l);
            if (p.stage === 'profiles') setProfiles(p.profiles || []);
          } catch {}
        }
      }
    } catch {}
    setLoading(false);
  }, [jetsonHost]);

  useEffect(() => { if (open) loadProfiles(); }, [open, loadProfiles]);

  const activateProfile = async (name) => {
    await sshExec(jetsonHost, `python3 /home/ada/calibrate_headless.py --activate-profile "${name}"`, domainId);
    await loadProfiles();
    if (onProfileActivated) onProfileActivated(name);
  };

  const deleteProfile = async (name) => {
    await sshExec(jetsonHost, `python3 /home/ada/calibrate_headless.py --delete-profile "${name}"`, domainId);
    await loadProfiles();
  };

  const startCalib = async () => {
    if (!profileName.trim()) return;
    setRunning(true); setCalibrating(false); setLogs([]); setProgress({}); setResult(null); offsetRef.current = 0;
    const typeFlag = camType !== 'normal' ? ` --type ${camType}` : '';
    const cmd = `python3 /home/ada/calibrate_headless.py --target ${target} --camera ${camera}${typeFlag} --profile "${profileName}" --description "${description}"`;
    try {
      const data = await apiLaunch('calibration', `${rosEnv(domainId)} && ${cmd} 2>/dev/null`, jetsonHost);
      if (!data.ok) { setLogs([{ stage: 'error', message: data.error }]); setRunning(false); return; }
      pollRef.current = setInterval(async () => {
        try {
          const d = await apiOutput('calibration', offsetRef.current);
          if (d.lines) {
            offsetRef.current = d.offset;
            const parsed = d.lines.split('\n').filter(Boolean).map((l) => {
              try { return JSON.parse(l); } catch { return { stage: 'log', message: l }; }
            });
            setLogs((prev) => [...prev, ...parsed]);
            parsed.forEach((p) => {
              if (p.stage === 'capture' && p.saved) setProgress((prev) => ({ ...prev, [p.camera]: { saved: p.saved, target: p.target } }));
              if (p.stage === 'calibrating') setCalibrating(true);
              if (p.stage === 'done') setResult((prev) => ({ ...(prev || {}), [p.camera]: p }));
            });
          }
          if (d.done) { clearInterval(pollRef.current); setRunning(false); loadProfiles(); }
        } catch {}
      }, 500);
    } catch (e) { setLogs([{ stage: 'error', message: e.message }]); setRunning(false); }
  };

  const stopCalib = async () => {
    clearInterval(pollRef.current);
    try { await apiStop('calibration'); } catch {}
    setRunning(false);
    setLogs((prev) => [...prev, { stage: 'info', message: 'Cancelled — previous calibration preserved.' }]);
  };

  // Cleanup on unmount: stop polling AND kill calibration process if still running
  const runningRef = useRef(false);
  runningRef.current = running;
  useEffect(() => () => {
    clearInterval(pollRef.current);
    if (runningRef.current) {
      apiStop('calibration').catch(() => {});
    }
  }, []);

  if (!open) return (
    <button onClick={() => setOpen(true)} style={s.toggleBtn}>📐 Intrinsic Calibration</button>
  );

  const camIds = camera === 'both' ? [0, 1] : [parseInt(camera)];
  const totalTarget = camIds.length * target;
  const totalSaved = camIds.reduce((a, id) => a + (progress[id]?.saved || 0), 0);

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>📐 Intrinsic Calibration</span>
        <button onClick={() => setOpen(false)} style={s.closeBtn}>✕</button>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        <button style={s.tab(tab === 'profiles')} onClick={() => setTab('profiles')}>
          Saved Profiles <span style={s.badge}>{profiles.length}/5</span>
        </button>
        <button style={s.tab(tab === 'new')} onClick={() => setTab('new')}>+ New Calibration</button>
      </div>

      {/* Profiles tab */}
      {tab === 'profiles' && (
        <div style={s.body}>
          {loading ? <div style={s.muted}>Loading...</div> :
           profiles.length === 0 ? <div style={s.muted}>No saved profiles. Create one in "New Calibration".</div> :
           profiles.map((p) => (
            <div key={p.name} style={s.profileCard}>
              <div style={s.profileHeader}>
                <div>
                  <div style={s.profileName}>{p.name}</div>
                  <div style={s.profileDesc}>{p.description || 'No description'}</div>
                  <div style={s.profileDate}>{p.date}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(p.cam0_active && p.cam1_active)
                    ? <span style={s.activeBadge}>✓ Active</span>
                    : <button style={s.activateBtn} onClick={() => activateProfile(p.name)}>Activate</button>
                  }
                  <button style={s.deleteBtn} onClick={() => deleteProfile(p.name)}>✕</button>
                </div>
              </div>
              {p.cameras && (
                <div style={s.profileCams}>
                  {Object.entries(p.cameras).map(([cid, c]) => (
                    <div key={cid} style={s.profileCam}>
                      <span style={s.profileCamLabel}>
                        cam{cid}
                        {p[`cam${cid}_active`] && <span style={{ color: '#00d26a', marginLeft: 6 }}>● active</span>}
                      </span>
                      <span style={s.profileStat}>err: {c.reprojection_error}</span>
                      <span style={s.profileStat}>fx:{c.fx} fy:{c.fy}</span>
                      <span style={s.profileStat}>cx:{c.cx} cy:{c.cy}</span>
                      <span style={s.profileStat}>{c.images_used} imgs</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New calibration tab */}
      {tab === 'new' && (
        <div style={s.body}>
          <div style={s.formRow}>
            <div style={s.field}>
              <label style={s.label}>Profile name *</label>
              <input style={s.input} placeholder="e.g. field_test_v2" value={profileName} onChange={(e) => setProfileName(e.target.value)} disabled={running} />
            </div>
            <div style={{ ...s.field, flex: 2 }}>
              <label style={s.label}>Description</label>
              <input style={s.input} placeholder="e.g. Outdoor, 2m distance, overcast" value={description} onChange={(e) => setDescription(e.target.value)} disabled={running} />
            </div>
          </div>
          <div style={s.formRow}>
            <div style={s.field}>
              <label style={s.label}>Images per camera</label>
              <input type="number" min={5} max={200} style={s.input} value={target} onChange={(e) => setTarget(Math.max(5, +e.target.value))} disabled={running} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Camera</label>
              <select style={s.input} value={camera} onChange={(e) => setCamera(e.target.value)} disabled={running}>
                <option value="both">Both</option>
                <option value="0">Camera 0</option>
                <option value="1">Camera 1</option>
              </select>
            </div>
            <div style={s.field}>
              <label style={s.label}>Lens type</label>
              <select style={s.input} value={camType} onChange={(e) => setCamType(e.target.value)} disabled={running}>
                <option value="normal">Normal</option>
                <option value="fisheye">Fisheye</option>
              </select>
            </div>
            <div style={s.field}>
              {!running
                ? <button onClick={startCalib} disabled={!profileName.trim() || profiles.length >= 5} style={s.startBtn}>▶ Start</button>
                : <button onClick={stopCalib} style={s.stopBtn}>⏹ Cancel</button>
              }
            </div>
          </div>

          {profiles.length >= 5 && !running && (
            <div style={s.warn}>Max 5 profiles reached. Delete one from the Profiles tab first.</div>
          )}

          {running && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {camIds.map((id) => {
                const p = progress[id];
                const saved = p?.saved || 0;
                const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
                return (
                  <div key={id} style={s.progressWrap}>
                    <span style={{ fontSize: 11, color: '#ccc', fontWeight: 600, width: 50 }}>cam{id}</span>
                    <div style={s.progressBar}><div style={{ ...s.progressFill, width: `${pct}%` }} /></div>
                    <span style={s.progressText}>{saved} / {target}</span>
                  </div>
                );
              })}
              <CalibPreview camIds={camIds} jetsonHost={jetsonHost} progress={progress} target={target} calibrating={calibrating} />
            </div>
          )}

          {result && (
            <div style={s.resultCards}>
              {Object.entries(result).map(([cid, r]) => (
                <div key={cid} style={s.resultCard}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Camera {cid}</div>
                  <div style={s.rr}><span style={s.rl}>Images</span><span>{r.images_used}</span></div>
                  <div style={s.rr}><span style={s.rl}>Error</span><span style={{ color: r.reprojection_error < 0.5 ? '#00d26a' : '#ffa502' }}>{r.reprojection_error}</span></div>
                  <div style={s.rr}><span style={s.rl}>fx, fy</span><span>{r.fx}, {r.fy}</span></div>
                  <div style={s.rr}><span style={s.rl}>cx, cy</span><span>{r.cx}, {r.cy}</span></div>
                </div>
              ))}
            </div>
          )}

          {logs.length > 0 && (
            <div style={s.logBox}>
              {logs.map((l, i) => (
                <div key={i} style={{ color: l.stage === 'error' ? '#ff4757' : l.stage === 'done' ? '#00d26a' : '#888' }}>
                  {l.message || JSON.stringify(l)}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}

          <div style={s.hint}>Hold a ChArUco board (8×11, DICT_4X4) in front of the cameras. Auto-captures when detected. Cancel preserves previous calibration.</div>
        </div>
      )}
    </div>
  );
};

const s = {
  toggleBtn: { padding: '10px 20px', background: '#111118', border: '1px solid #1e1e2a', borderRadius: 10, color: '#888', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', textAlign: 'left' },
  panel: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #1e1e2a' },
  closeBtn: { background: 'none', border: 'none', color: '#666', fontSize: 16, cursor: 'pointer' },
  tabs: { display: 'flex', borderBottom: '1px solid #1e1e2a' },
  tab: (active) => ({
    flex: 1, padding: '10px 16px', background: 'none', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    color: active ? '#e0e0e6' : '#555', borderBottom: active ? '2px solid #6c5ce7' : '2px solid transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  }),
  badge: { fontSize: 10, padding: '1px 7px', borderRadius: 10, background: '#1a1a24', color: '#555' },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 500, overflow: 'auto' },
  muted: { color: '#555', fontSize: 12, textAlign: 'center', padding: 20 },

  // Profiles
  profileCard: { background: '#0a0a0f', border: '1px solid #1e1e2a', borderRadius: 10, overflow: 'hidden' },
  profileHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 14px' },
  profileName: { fontSize: 13, fontWeight: 700, color: '#e0e0e6' },
  profileDesc: { fontSize: 11, color: '#888', marginTop: 2 },
  profileDate: { fontSize: 10, color: '#555', marginTop: 2 },
  activateBtn: { padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#6c5ce715', border: '1px solid #6c5ce744', color: '#6c5ce7', whiteSpace: 'nowrap' },
  activeBadge: { padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: '#00d26a22', border: '1px solid #00d26a', color: '#00d26a', whiteSpace: 'nowrap' },
  deleteBtn: { padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: '#ff475712', border: '1px solid #ff475733', color: '#ff4757' },
  profileCams: { display: 'flex', gap: 8, padding: '0 14px 12px' },
  profileCam: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', background: '#111118', borderRadius: 6, fontSize: 10, color: '#aaa' },
  profileCamLabel: { fontWeight: 700, fontSize: 11, color: '#ccc', marginBottom: 2 },
  profileStat: { color: '#666', fontFamily: "'JetBrains Mono', monospace" },

  // Form
  formRow: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' },
  field: { flex: 1, minWidth: 100 },
  label: { display: 'block', fontSize: 10, color: '#666', marginBottom: 3, fontWeight: 600 },
  input: { width: '100%', padding: '7px 10px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, color: '#ccc', fontSize: 12, outline: 'none', boxSizing: 'border-box' },
  startBtn: { padding: '8px 18px', background: '#00d26a15', border: '1px solid #00d26a44', borderRadius: 8, color: '#00d26a', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 16, whiteSpace: 'nowrap' },
  stopBtn: { padding: '8px 18px', background: '#ff475715', border: '1px solid #ff475744', borderRadius: 8, color: '#ff4757', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 16, whiteSpace: 'nowrap' },
  warn: { padding: '6px 10px', background: '#ffa50212', border: '1px solid #ffa50233', borderRadius: 6, color: '#ffa502', fontSize: 11 },

  // Progress
  progressWrap: { display: 'flex', alignItems: 'center', gap: 10 },
  progressBar: { flex: 1, height: 6, background: '#1a1a24', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', background: '#6c5ce7', borderRadius: 3, transition: 'width 0.3s' },
  progressText: { fontSize: 11, color: '#888', fontWeight: 600 },

  // Results
  resultCards: { display: 'flex', gap: 10 },
  resultCard: { flex: 1, background: '#0a0a0f', border: '1px solid #1e1e2a', borderRadius: 8, padding: 10 },
  rr: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#ccc', padding: '1px 0' },
  rl: { color: '#666' },

  logBox: { maxHeight: 120, overflow: 'auto', padding: 10, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5, background: '#0a0a0f', borderRadius: 6 },
  hint: { fontSize: 10, color: '#444' },
};
