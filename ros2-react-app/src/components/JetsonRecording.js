import { useState, useEffect, useRef } from 'react';
import ROSLIB from 'roslib';

const SSH_URL = 'http://localhost:4500';

const STORAGE_KEY = 'agrotech_jetson_rec_topics';

const DEFAULT_REC_TOPICS = [
  { key: 'cam0_raw', topic: '/jetson/cam0/image_raw/compressed', type: 'sensor_msgs/CompressedImage', enabled: true },
  { key: 'cam0_undist', topic: '/jetson/cam0/image_undistorted/compressed', type: 'sensor_msgs/CompressedImage', enabled: true },
  { key: 'cam1_raw', topic: '/jetson/cam1/image_raw/compressed', type: 'sensor_msgs/CompressedImage', enabled: true },
  { key: 'cam1_undist', topic: '/jetson/cam1/image_undistorted/compressed', type: 'sensor_msgs/CompressedImage', enabled: true },
];

const loadTopics = () => {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch {} return null;
};
const saveTopics = (t) => localStorage.setItem(STORAGE_KEY, JSON.stringify(t));

export const JetsonRecording = ({ jetsonHost, connected }) => {
  const [topics, setTopics] = useState(() => loadTopics() || DEFAULT_REC_TOPICS);
  const [patrolId, setPatrolId] = useState('');
  const [recordingId, setRecordingId] = useState('');
  const [recording, setRecording] = useState(false);
  const [mcapFrames, setMcapFrames] = useState(0);
  const [error, setError] = useState('');
  const [overwriteWarn, setOverwriteWarn] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [newType, setNewType] = useState('sensor_msgs/CompressedImage');
  const [availableTopics, setAvailableTopics] = useState([]);
  const pollRef = useRef(null);
  const offsetRef = useRef(0);

  // Fetch available ROS topics for the "add" picker
  useEffect(() => {
    if (!connected) return;
    const ros = new ROSLIB.Ros({ url: `ws://${jetsonHost}:9090` });
    ros.on('connection', () => {
      ros.getTopics((result) => {
        setAvailableTopics(result.topics.map((name, i) => ({ name, type: result.types[i] })));
        ros.close();
      });
    });
    ros.on('error', () => {});
    return () => { try { ros.close(); } catch {} };
  }, [connected, jetsonHost]);

  const enabledTopics = topics.filter(t => t.enabled);

  const toggleTopic = (key) => {
    const next = topics.map(t => t.key === key ? { ...t, enabled: !t.enabled } : t);
    setTopics(next);
    saveTopics(next);
  };

  const removeTopic = (key) => {
    const next = topics.filter(t => t.key !== key);
    setTopics(next);
    saveTopics(next);
  };

  const addTopic = () => {
    if (!newTopic) return;
    const key = newTopic.replace(/\//g, '_').replace(/^_/, '');
    const type = availableTopics.find(t => t.name === newTopic)?.type || newType;
    const next = [...topics, { key, topic: newTopic, type, enabled: true }];
    setTopics(next);
    saveTopics(next);
    setNewTopic('');
    setAdding(false);
  };

  const toggleRecording = async () => {
    if (recording) {
      try { await fetch(`${SSH_URL}/ssh/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'mcap_recorder' }) }); } catch {}
      clearInterval(pollRef.current);
      setRecording(false);
      return;
    }
    if (!patrolId.trim() || !recordingId.trim()) { setError('Patrol ID and Recording ID are required.'); return; }
    if (enabledTopics.length === 0) { setError('Select at least one topic to record.'); return; }
    setError('');

    if (!overwriteWarn) {
      try {
        const chk = await fetch(`${SSH_URL}/ssh/exec`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: jetsonHost, user: 'hec', password: 'h3ll0', command: `test -d /AgroTech_recordings/${patrolId}/${recordingId} && echo EXISTS || echo NO` }),
        });
        const d = await chk.json();
        if (d.ok && d.output.trim() === 'EXISTS') { setOverwriteWarn(true); return; }
      } catch {}
    }
    setOverwriteWarn(false);
    setMcapFrames(0);
    offsetRef.current = 0;

    // Build topics arg as topic:type pairs for recorder
    const topicsArg = enabledTopics.map(t => `${t.topic}:${t.type}`).join(',');
    try {
      await fetch(`${SSH_URL}/ssh/launch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'mcap_recorder', host: jetsonHost, user: 'hec', password: 'h3ll0',
          command: `source /opt/ros/humble/setup.bash && python3 /home/hec/mcap_recorder.py --patrol "${patrolId}" --recording "${recordingId}" --topics "${topicsArg}"`,
        }),
      });
    } catch {}
    setRecording(true);

    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${SSH_URL}/ssh/output`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'mcap_recorder', since: offsetRef.current }),
        });
        const d = await r.json();
        if (d.lines) {
          offsetRef.current = d.offset;
          for (const l of d.lines.split('\n').filter(Boolean)) {
            try { const p = JSON.parse(l); if (p.counts) setMcapFrames(Object.values(p.counts).reduce((a, b) => a + b, 0)); } catch {}
          }
        }
      } catch {}
    }, 1000);
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  // Topics not yet in the recording list
  const unusedTopics = availableTopics.filter(at => !topics.some(t => t.topic === at.name));

  return (
    <div style={st.container}>
      {/* Topic selector */}
      <div style={st.section}>
        <div style={st.sectionHeader}>
          <span style={st.sectionTitle}>Topics to Record</span>
          <span style={st.badge}>{enabledTopics.length}/{topics.length} enabled</span>
        </div>
        <div style={st.topicList}>
          {topics.map(t => (
            <div key={t.key} style={st.topicRow}>
              <button style={st.checkbox(t.enabled)} onClick={() => toggleTopic(t.key)}>
                {t.enabled ? '✓' : ''}
              </button>
              <div style={st.topicInfo}>
                <div style={st.topicName(t.enabled)}>{t.topic}</div>
                <div style={st.topicType}>{t.type}</div>
              </div>
              {!DEFAULT_REC_TOPICS.some(d => d.key === t.key) && (
                <button style={st.rmBtn} onClick={() => removeTopic(t.key)}>✕</button>
              )}
            </div>
          ))}
        </div>

        {adding ? (
          <div style={st.addRow}>
            <select style={st.select} value={newTopic} onChange={e => { setNewTopic(e.target.value); const found = availableTopics.find(t => t.name === e.target.value); if (found) setNewType(found.type); }}>
              <option value="">Select topic...</option>
              {unusedTopics.map(t => <option key={t.name} value={t.name}>{t.name} ({t.type})</option>)}
            </select>
            <input style={st.typeInput} value={newType} onChange={e => setNewType(e.target.value)} placeholder="Type" />
            <button style={st.addConfirm} onClick={addTopic}>Add</button>
            <button style={st.cancelBtn} onClick={() => setAdding(false)}>✕</button>
          </div>
        ) : (
          <button style={st.addBtn} onClick={() => setAdding(true)}>+ Add Topic</button>
        )}

        <div style={st.hint}>
          All topics are saved as MCAP — optimal for synchronized playback and Foxglove Studio.
        </div>
      </div>

      {/* Recording controls */}
      <div style={st.section}>
        <div style={st.sectionHeader}>
          <span style={st.sectionTitle}>Record</span>
          {recording && <span style={st.recBadge}>● REC — {mcapFrames} frames</span>}
        </div>
        <div style={st.recRow}>
          <input style={{ ...st.input, ...(error && !patrolId.trim() ? { borderColor: '#ff475766' } : {}) }}
            placeholder="Patrol ID" value={patrolId}
            onChange={e => { setPatrolId(e.target.value); setError(''); setOverwriteWarn(false); }}
            disabled={recording} />
          <input style={{ ...st.input, ...(error && !recordingId.trim() ? { borderColor: '#ff475766' } : {}) }}
            placeholder="Recording ID" value={recordingId}
            onChange={e => { setRecordingId(e.target.value); setError(''); setOverwriteWarn(false); }}
            disabled={recording} />
          <button onClick={toggleRecording} style={st.recBtn(recording)}>
            <span style={st.recDot(recording)} />
            {recording ? 'Stop' : overwriteWarn ? '⚠ Overwrite?' : 'Record'}
          </button>
        </div>
        {error && <div style={st.errorMsg}>{error}</div>}
      </div>
    </div>
  );
};

const st = {
  container: { display: 'flex', flexDirection: 'column', gap: 16 },
  section: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, padding: 16 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#e0e0e6' },
  badge: { fontSize: 10, color: '#6c5ce7', background: '#6c5ce712', padding: '2px 8px', borderRadius: 8 },

  topicList: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 },
  topicRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#0d0d14', borderRadius: 8 },
  checkbox: (on) => ({
    width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
    background: on ? '#00d26a18' : '#1a1a24',
    border: `1px solid ${on ? '#00d26a44' : '#2a2a3a'}`,
    color: on ? '#00d26a' : 'transparent',
  }),
  topicInfo: { flex: 1, minWidth: 0 },
  topicName: (on) => ({ fontSize: 12, fontWeight: 500, color: on ? '#e0e0e6' : '#555', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  topicType: { fontSize: 10, color: '#555', marginTop: 1 },
  rmBtn: { background: '#ff475712', border: '1px solid #ff475733', borderRadius: 6, color: '#ff4757', width: 24, height: 24, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  addRow: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 },
  select: { flex: 2, padding: '7px 8px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, color: '#ccc', fontSize: 11, outline: 'none' },
  typeInput: { flex: 1, padding: '7px 8px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, color: '#ccc', fontSize: 11, outline: 'none' },
  addConfirm: { padding: '6px 12px', background: '#00d26a15', border: '1px solid #00d26a44', borderRadius: 6, color: '#00d26a', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  cancelBtn: { background: 'none', border: 'none', color: '#666', fontSize: 14, cursor: 'pointer' },
  addBtn: { padding: '6px 12px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#888', fontSize: 11, cursor: 'pointer', alignSelf: 'flex-start' },
  hint: { fontSize: 10, color: '#444', marginTop: 8, fontStyle: 'italic' },

  recRow: { display: 'flex', gap: 10, alignItems: 'center' },
  input: { flex: 1, padding: '8px 12px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#ccc', fontSize: 12, outline: 'none', boxSizing: 'border-box' },
  recBtn: (active) => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', whiteSpace: 'nowrap',
    background: active ? '#ff475715' : '#00d26a15', border: `1px solid ${active ? '#ff475744' : '#00d26a44'}`,
    borderRadius: 8, color: active ? '#ff4757' : '#00d26a', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  }),
  recDot: (active) => ({ width: 8, height: 8, borderRadius: '50%', background: active ? '#ff4757' : '#00d26a', boxShadow: active ? '0 0 8px #ff475788' : 'none' }),
  recBadge: { fontSize: 11, color: '#ff4757', fontWeight: 700, letterSpacing: '1px' },
  errorMsg: { marginTop: 8, padding: '6px 12px', background: '#ff475712', border: '1px solid #ff475733', borderRadius: 8, color: '#ff4757', fontSize: 11, fontWeight: 600 },
};
