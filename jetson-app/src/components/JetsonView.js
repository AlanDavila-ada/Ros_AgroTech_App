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
const ImageStream = ({ ros, topic, label, fullscreen }) => {
  const [src, setSrc] = useState(null);
  const [fps, setFps] = useState(0);
  const countRef = useRef(0);
  const urlRef = useRef(null);
  const timeoutRef = useRef(null);

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
      // Reset stale timeout on every frame
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => { setSrc(null); setFps(0); }, 5000);
    });
    const iv = setInterval(() => { setFps(countRef.current); countRef.current = 0; }, 1000);
    return () => { sub.unsubscribe(); clearInterval(iv); clearTimeout(timeoutRef.current); if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [ros, topic]);

  return (
    <div style={fullscreen ? cs.cardFs : cs.card}>
      <div style={cs.cardHeader}>
        <span style={cs.cardLabel}>{label}</span>
        <span style={cs.fps}>{fps > 0 ? `${fps} fps` : '—'}</span>
      </div>
      <div style={fullscreen ? cs.imgWrapFs : cs.imgWrap}>
        {src ? <img src={src} alt={label} style={fullscreen ? cs.imgFs : cs.img} onClick={e => e.stopPropagation()} /> : <div style={cs.ph}>Waiting for frames...</div>}
      </div>
    </div>
  );
};

export const JetsonView = ({ ros, connected, jetsonHost, domainId }) => {
  const [tab, setTab] = useState('setup');
  const [showPreview, setShowPreview] = useState(false);
  const [fullscreen, setFullscreen] = useState(null); // { topic, label }

  return (
    <main style={st.main}>
      {/* Fullscreen overlay */}
      {fullscreen && (
        <div style={st.fsOverlay} onClick={() => setFullscreen(null)}>
          <button style={st.fsClose} onClick={() => setFullscreen(null)}>✕</button>
          <ImageStream ros={ros} topic={fullscreen.topic} label={fullscreen.label} fullscreen />
          <div style={st.fsHint}>Click anywhere or ✕ to exit</div>
        </div>
      )}

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
              <div onClick={() => setFullscreen({ topic: `/jetson/${cam}/image_raw/compressed`, label: `${cam} Raw` })} style={{ cursor: 'pointer', flex: 1 }}>
                <ImageStream ros={ros} topic={`/jetson/${cam}/image_raw/compressed`} label={`${cam} Raw`} />
              </div>
              <div onClick={() => setFullscreen({ topic: `/jetson/${cam}/image_undistorted/compressed`, label: `${cam} Undist` })} style={{ cursor: 'pointer', flex: 1 }}>
                <ImageStream ros={ros} topic={`/jetson/${cam}/image_undistorted/compressed`} label={`${cam} Undist`} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div style={st.content}>
        {tab === 'setup' && <JetsonSetup jetsonHost={jetsonHost} connected={connected} domainId={domainId} />}
        {tab === 'recording' && <JetsonRecording jetsonHost={jetsonHost} connected={connected} ros={ros} domainId={domainId} />}
        {tab === 'recordings' && <RecordingsView jetsonHost={jetsonHost} domainId={domainId} />}
        {tab === 'monitor' && <JetsonMonitor jetsonHost={jetsonHost} connected={connected} />}
        {tab === 'upload' && <JetsonUpload jetsonHost={jetsonHost} />}
      </div>
    </main>
  );
};

const cs = {
  card: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 10, overflow: 'hidden', flex: 1 },
  cardFs: { background: '#111118', borderRadius: 10, overflow: 'hidden', maxWidth: '90vw', maxHeight: '85vh' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #1e1e2a' },
  cardLabel: { fontSize: 11, fontWeight: 600, color: '#aaa' },
  fps: { fontSize: 10, color: '#00d26a', fontWeight: 700 },
  imgWrap: { position: 'relative', background: '#0a0a0f', minHeight: 120 },
  imgWrapFs: { position: 'relative', background: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  img: { width: '100%', display: 'block' },
  imgFs: { maxWidth: '90vw', maxHeight: '80vh', display: 'block', objectFit: 'contain' },
  ph: { padding: 30, textAlign: 'center', color: '#444', fontSize: 11 },
};

const st = {
  main: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' },

  fsOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, cursor: 'pointer', flexDirection: 'column', gap: 12 },
  fsClose: { position: 'fixed', top: 16, right: 16, width: 36, height: 36, borderRadius: '50%', background: '#ff475722', border: '1px solid #ff475744', color: '#ff4757', fontSize: 18, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 },
  fsHint: { fontSize: 11, color: '#555', letterSpacing: '0.5px' },

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
