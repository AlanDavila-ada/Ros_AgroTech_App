import { useState, useRef, useEffect } from 'react';
import { useRos } from './hooks/useRos';
import { useRecordingStatus } from './hooks/useRecordingStatus';
import { useEventLogger, setLoggerContext } from './hooks/useEventLogger';
import { Sidebar } from './components/Sidebar';
import { LocalView } from './components/LocalView';
import { JetsonView } from './components/JetsonView';
import { apiStop, apiConfig } from './apiSsh';
import ROSLIB from 'roslib';

const fmtElapsed = (s) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
const fmtId = (id) => id ? (id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id) : '—';

function App() {
  const [jetsonHost, setJetsonHost] = useState('localhost');
  const [jetsonPort, setJetsonPort] = useState('9090');
  const [domainId, setDomainId] = useState('42');

  const { ros: localRos, connected: localConnected } = useRos('ws://localhost:9090');
  const { ros: jetsonRos, connected: jetsonConnected } = useRos(`ws://${jetsonHost}:${jetsonPort}`);

  const [view, setView] = useState('local');
  const [jetsonTab, setJetsonTab] = useState('setup');

  const rec = useRecordingStatus(jetsonRos, jetsonConnected);
  const log = useEventLogger(jetsonHost);
  const stoppingRef = useRef(false);
  const [identity, setIdentity] = useState({ customerId: '', deviceId: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await apiConfig(jetsonHost);
        if (cancelled || !c.ok) return;
        setIdentity({ customerId: c.customerId || '', deviceId: c.deviceId || '' });
        setLoggerContext({ customer: c.customerId, device: c.deviceId });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [jetsonHost]);

  const prevActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    const isActive = !!rec.active;
    if (isActive && rec.ids) {
      setLoggerContext({ patrol: rec.ids.patrol, recording: rec.ids.recording });
    }
    if (wasActive && !isActive) {
      const ids = rec.lastIds;
      if (ids) setLoggerContext({ patrol: ids.patrol, recording: ids.recording });
      log('info', 'recording.stopped', {
        elapsed: rec.elapsed, frames: rec.totalFrames,
        ...(ids ? { patrol: ids.patrol, recording: ids.recording } : {}),
      });
      setTimeout(() => setLoggerContext({ patrol: null, recording: null }), 100);
    }
    if (!wasActive && isActive && rec.ids) {
      log('info', 'recording.started', { patrol: rec.ids.patrol, recording: rec.ids.recording });
    }
    prevActiveRef.current = isActive;
  }, [rec.active, rec.ids, rec.lastIds, log, rec.elapsed, rec.totalFrames]);

  useEffect(() => {
    if (rec.stale && rec.active) log('warn', 'recording.status.stale', {});
  }, [rec.stale, rec.active, log]);

  useEffect(() => {
    log(jetsonConnected ? 'info' : 'warn', jetsonConnected ? 'jetson.connected' : 'jetson.disconnected', { host: jetsonHost });
  }, [jetsonConnected, jetsonHost, log]);

  const stopFromIndicator = async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    rec.markPending('stop');
    log('info', 'recording.stop.requested', { source: 'global_bar' });
    try {
      if (jetsonRos) {
        const t = new ROSLIB.Topic({ ros: jetsonRos, name: '/recording/command', messageType: 'std_msgs/String' });
        t.publish(new ROSLIB.Message({ data: JSON.stringify({ action: 'stop' }) }));
      }
      try { await apiStop('mcap_recorder', jetsonHost); } catch {}
    } finally {
      setTimeout(() => { stoppingRef.current = false; }, 2000);
    }
  };

  const goToRecordingTab = () => { setView('jetson'); setJetsonTab('recording'); };

  return (
    <div style={styles.app}>
      <Sidebar
        ros={view === 'jetson' ? jetsonRos : localRos}
        connected={view === 'jetson' ? jetsonConnected : localConnected}
        view={view}
        onViewChange={setView}
        jetsonHost={jetsonHost}
        onJetsonHostChange={setJetsonHost}
        jetsonPort={jetsonPort}
        onJetsonPortChange={setJetsonPort}
        domainId={domainId}
        onDomainIdChange={setDomainId}
        localConnected={localConnected}
        jetsonConnected={jetsonConnected}
        recordingActive={rec.active}
      />
      <div style={styles.content}>
        <RecordingStatusBar rec={rec} jetsonConnected={jetsonConnected} onStop={stopFromIndicator} onGoToRecordingTab={goToRecordingTab} />
        {view === 'jetson' ? (
          <JetsonView ros={jetsonRos} connected={jetsonConnected} jetsonHost={jetsonHost} domainId={domainId} tab={jetsonTab} onTabChange={setJetsonTab} rec={rec} identity={identity} />
        ) : (
          <LocalViewWrapper ros={localRos} />
        )}
      </div>
    </div>
  );
}

const LocalViewWrapper = ({ ros }) => {
  const [recording, setRecording] = useState(false);
  const [patrolId, setPatrolId] = useState('');
  const [recordingId, setRecordingId] = useState('');
  return (
    <LocalView
      ros={ros}
      recording={recording} setRecording={setRecording}
      patrolId={patrolId} setPatrolId={setPatrolId}
      recordingId={recordingId} setRecordingId={setRecordingId}
    />
  );
};

const RecordingStatusBar = ({ rec, jetsonConnected, onStop, onGoToRecordingTab }) => {
  const isActive = rec.active;
  const isStopping = rec.pending === 'stop';

  return (
    <div style={styles.statusBar(isActive)}>
      <div style={styles.statusLeft}>
        <div style={styles.recDot(isActive)} />
        <div style={styles.recLabel(isActive)}>
          {isStopping ? 'STOPPING…' : isActive ? 'RECORDING' : 'IDLE'}
        </div>
        {isActive && (
          <>
            <div style={styles.elapsed}>{fmtElapsed(rec.elapsed)}</div>
            <div style={styles.frames}>{rec.totalFrames} frames</div>
            {rec.ids && (
              <div style={styles.idsBlock}>
                <span style={styles.idLabel}>P</span><span style={styles.idVal}>{fmtId(rec.ids.patrol)}</span>
                <span style={styles.idLabel}>R</span><span style={styles.idVal}>{fmtId(rec.ids.recording)}</span>
              </div>
            )}
            {rec.stale && <div style={styles.stale}>⚠ status feed stale</div>}
          </>
        )}
        {!isActive && jetsonConnected && (
          <span style={styles.idleHint}>Open the Recording tab to start a patrol.</span>
        )}
        {!jetsonConnected && (
          <span style={styles.idleHint}>Jetson not connected — recording controls disabled.</span>
        )}
      </div>
      <div style={styles.statusRight}>
        <div style={styles.brandMark}>
          <span style={styles.brandAda}>Adalabs</span>
          <span style={styles.brandX}>×</span>
          <span style={styles.brandOrza}>Orza Tech</span>
        </div>
        {isActive ? (
          <button style={styles.stopBtn} onClick={onStop} disabled={isStopping}>
            {isStopping ? '⏳ Stopping…' : '⏹ Stop recording'}
          </button>
        ) : (
          jetsonConnected && (
            <button style={styles.goBtn} onClick={onGoToRecordingTab}>● Go to Recording</button>
          )
        )}
      </div>
    </div>
  );
};

const pulseKf = `
@keyframes recPulse {
  0%   { box-shadow: 0 0 0 0 rgba(255, 71, 87, 0.55); transform: scale(1); }
  60%  { box-shadow: 0 0 0 8px rgba(255, 71, 87, 0); transform: scale(1.08); }
  100% { box-shadow: 0 0 0 0 rgba(255, 71, 87, 0); transform: scale(1); }
}
@keyframes barPulse {
  0%, 100% { background: #1a0d10; }
  50%      { background: #221013; }
}
`;
if (typeof document !== 'undefined' && !document.getElementById('agrotech-rec-keyframes')) {
  const s = document.createElement('style');
  s.id = 'agrotech-rec-keyframes';
  s.innerText = pulseKf;
  document.head.appendChild(s);
}

const styles = {
  app: {
    display: 'flex', height: '100vh',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    background: '#0a0a0f', color: '#e0e0e6',
  },
  content: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  statusBar: (active) => ({
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 24px',
    borderBottom: `1px solid ${active ? '#ff475744' : '#1e1e2a'}`,
    background: active ? '#1a0d10' : 'transparent',
    animation: active ? 'barPulse 2.4s ease-in-out infinite' : 'none',
    minHeight: 52, flexShrink: 0,
  }),
  statusLeft: { display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 },
  statusRight: { display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 },
  recDot: (active) => ({
    width: 12, height: 12, borderRadius: '50%',
    background: active ? '#ff4757' : '#333',
    animation: active ? 'recPulse 1.6s ease-out infinite' : 'none', flexShrink: 0,
  }),
  recLabel: (active) => ({
    fontSize: 12, fontWeight: 800, letterSpacing: '2px',
    color: active ? '#ff4757' : '#555', flexShrink: 0,
  }),
  elapsed: { fontSize: 18, fontWeight: 700, color: '#ff9f43', fontVariantNumeric: 'tabular-nums', letterSpacing: '1px', paddingLeft: 8, borderLeft: '1px solid #ff475733', flexShrink: 0 },
  frames: { fontSize: 11, color: '#aaa', fontWeight: 600, flexShrink: 0 },
  idsBlock: { display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 12, marginLeft: 4, borderLeft: '1px solid #2a1518', fontFamily: 'monospace', minWidth: 0, overflow: 'hidden' },
  idLabel: { fontSize: 9, fontWeight: 800, color: '#ff475788', letterSpacing: '0.5px' },
  idVal: { fontSize: 11, color: '#bbb', marginRight: 6 },
  stale: { fontSize: 10, color: '#ffa502', fontWeight: 700, marginLeft: 8 },
  idleHint: { fontSize: 11, color: '#666' },
  brandMark: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, letterSpacing: '0.5px' },
  brandAda: { color: '#6c5ce7', fontWeight: 700 },
  brandX: { color: '#333', fontWeight: 300 },
  brandOrza: { color: '#00d26a', fontWeight: 700 },
  stopBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 18px', borderRadius: 8,
    background: '#ff4757', border: 'none', color: '#fff',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
    boxShadow: '0 0 12px #ff475744',
  },
  goBtn: { padding: '6px 14px', borderRadius: 8, background: '#6c5ce715', border: '1px solid #6c5ce744', color: '#6c5ce7', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
};

export default App;
