import { useState, useEffect, useRef } from 'react';
import ROSLIB from 'roslib';
import { JetsonSetup } from './JetsonSetup';
import { JetsonRecording } from './JetsonRecording';
import { RecordingsView } from './RecordingsView';
import { JetsonMonitor } from './JetsonMonitor';
import { JetsonUpload } from './JetsonUpload';

const TABS = [
  { id: 'setup', label: '⚙ Setup', icon: '⚙' },
  { id: 'recording', label: '🔴 Recording', icon: '🔴' },
  { id: 'recordings', label: '🎬 Recordings', icon: '🎬' },
  { id: 'monitor', label: '📊 Monitor', icon: '📊' },
  { id: 'upload', label: '☁️ Upload', icon: '☁️' },
];

/* Camera stream preview */
const ImageStream = ({ ros, topic, label }) => {
  const [src, setSrc] = useState(null);
  const [fps, setFps] = useState(0);
  const countRef = useRef(0);
  const urlRef = useRef(null);

  useEffect(() => {
    if (!ros) return;
    const sub = new ROSLIB.Topic({ ros, name: topic, messageType: 'sensor_msgs/CompressedImage' });
    sub.subscribe((msg) => {
      const raw = atob(msg.data);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(new Blob([arr], { type: 'image/jpeg' }));
      setSrc(urlRef.current);
      countRef.current++;
    });
    const iv = setInterval(() => { setFps(countRef.current); countRef.current = 0; }, 1000);
    return () => { sub.unsubscribe(); clearInterval(iv); if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [ros, topic]);

  return (
    <div style={cs.card}>
      <div style={cs.cardHeader}>
        <span style={cs.cardLabel}>{label}</span>
        <span style={cs.fps}>{fps > 0 ? `${fps} fps` : '—'}</span>
      </div>
      <div style={cs.imgWrap}>
        {src ? <img src={src} alt={label} style={cs.img} /> : <div style={cs.ph}>Waiting for frames...</div>}
      </div>
    </div>
  );
};

export const JetsonView = ({ ros, connected, jetsonHost }) => {
  const [tab, setTab] = useState('setup');
  const [showPreview, setShowPreview] = useState(false);

  return (
    <main style={st.main}>
      {/* Sub-navigation */}
      <div style={st.tabBar}>
        {TABS.map(t => (
          <button key={t.id} style={st.tab(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <div style={st.tabSpacer} />
        {connected && (
          <button style={st.previewToggle(showPreview)} onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? '👁 Hide Cameras' : '👁 Show Cameras'}
          </button>
        )}
      </div>

      {/* Camera preview strip */}
      {showPreview && connected && (
        <div style={st.previewStrip}>
          {['cam0', 'cam1'].map(cam => (
            <div key={cam} style={st.previewCol}>
              <ImageStream ros={ros} topic={`/jetson/${cam}/image_raw/compressed`} label={`${cam} Raw`} />
              <ImageStream ros={ros} topic={`/jetson/${cam}/image_undistorted/compressed`} label={`${cam} Undist`} />
            </div>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div style={st.content}>
        {tab === 'setup' && <JetsonSetup jetsonHost={jetsonHost} connected={connected} />}
        {tab === 'recording' && <JetsonRecording jetsonHost={jetsonHost} connected={connected} />}
        {tab === 'recordings' && <RecordingsView jetsonHost={jetsonHost} />}
        {tab === 'monitor' && <JetsonMonitor jetsonHost={jetsonHost} connected={connected} />}
        {tab === 'upload' && <JetsonUpload jetsonHost={jetsonHost} />}
      </div>
    </main>
  );
};

const cs = {
  card: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 10, overflow: 'hidden', flex: 1 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #1e1e2a' },
  cardLabel: { fontSize: 11, fontWeight: 600, color: '#aaa' },
  fps: { fontSize: 10, color: '#00d26a', fontWeight: 700 },
  imgWrap: { position: 'relative', background: '#0a0a0f', minHeight: 120 },
  img: { width: '100%', display: 'block' },
  ph: { padding: 30, textAlign: 'center', color: '#444', fontSize: 11 },
};

const st = {
  main: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' },

  tabBar: {
    display: 'flex', alignItems: 'center', gap: 2, padding: '12px 24px 0',
    borderBottom: '1px solid #1e1e2a', flexShrink: 0,
  },
  tab: (active) => ({
    padding: '10px 16px', background: 'none', border: 'none',
    borderBottom: active ? '2px solid #6c5ce7' : '2px solid transparent',
    color: active ? '#e0e0e6' : '#555', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.15s',
  }),
  tabSpacer: { flex: 1 },
  previewToggle: (on) => ({
    padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
    background: on ? '#6c5ce712' : '#1a1a24',
    border: `1px solid ${on ? '#6c5ce733' : '#2a2a3a'}`,
    color: on ? '#e0e0e6' : '#666',
  }),

  previewStrip: { display: 'flex', gap: 12, padding: '12px 24px', borderBottom: '1px solid #1e1e2a', flexShrink: 0 },
  previewCol: { flex: 1, display: 'flex', gap: 8 },

  content: { flex: 1, overflow: 'auto', padding: 24 },
};
