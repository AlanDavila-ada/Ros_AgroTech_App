import { useState } from 'react';
import { useRos } from './hooks/useRos';
import { Sidebar } from './components/Sidebar';
import { LocalView } from './components/LocalView';
import { JetsonView } from './components/JetsonView';
import { isLocal, getRosbridgeUrl } from './api';

function App() {
  const [jetsonHost, setJetsonHost] = useState(isLocal ? window.location.hostname : '192.168.15.173');
  const [jetsonPort, setJetsonPort] = useState('9090');
  const [domainId, setDomainId] = useState('42');

  const { ros: localRos, connected: localConnected } = useRos(isLocal ? null : 'ws://localhost:9090');
  const { ros: jetsonRos, connected: jetsonConnected } = useRos(getRosbridgeUrl(jetsonHost, jetsonPort));

  const [view, setView] = useState(isLocal ? 'jetson' : 'local');

  const [recording, setRecording] = useState(false);
  const [patrolId, setPatrolId] = useState('');
  const [recordingId, setRecordingId] = useState('');

  const isRec = recording;

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
      />
      <div style={styles.content}>
        <div style={styles.topNav}>
          <div style={styles.recIndicator}>
            <div style={styles.recDot(isRec)} />
            <span style={styles.recText(isRec)}>{isRec ? 'REC' : 'IDLE'}</span>
          </div>
          <div style={styles.viewLabel}>
            {isLocal ? '🤖 Jetson (local)' : view === 'jetson' ? '📡 Jetson' : '💻 Local'}
          </div>
          <div style={styles.brandMark}>
            <span style={styles.brandAda}>Adalabs</span>
            <span style={styles.brandX}>×</span>
            <span style={styles.brandOrza}>Orza Tech</span>
          </div>
        </div>
        {view === 'jetson' ? (
          <JetsonView ros={jetsonRos} connected={jetsonConnected} jetsonHost={jetsonHost} domainId={domainId} />
        ) : (
          <LocalView
            ros={localRos}
            recording={recording}
            setRecording={setRecording}
            patrolId={patrolId}
            setPatrolId={setPatrolId}
            recordingId={recordingId}
            setRecordingId={setRecordingId}
          />
        )}
      </div>
    </div>
  );
}

const styles = {
  app: {
    display: 'flex', height: '100vh',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    background: '#0a0a0f', color: '#e0e0e6',
  },
  content: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  topNav: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 24px', borderBottom: '1px solid #1e1e2a', minHeight: 48,
  },
  viewLabel: { fontSize: 13, fontWeight: 600, color: '#888' },
  brandMark: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, letterSpacing: '0.5px' },
  brandAda: { color: '#6c5ce7', fontWeight: 700 },
  brandX: { color: '#333', fontWeight: 300 },
  brandOrza: { color: '#00d26a', fontWeight: 700 },
  recIndicator: { display: 'flex', alignItems: 'center', gap: 8 },
  recDot: (on) => ({
    width: 10, height: 10, borderRadius: '50%',
    background: on ? '#ff4757' : '#333',
    boxShadow: on ? '0 0 10px #ff475788' : 'none', transition: 'all 0.3s',
  }),
  recText: (on) => ({
    fontSize: 10, fontWeight: 700, letterSpacing: '1.5px',
    color: on ? '#ff4757' : '#444',
  }),
};

export default App;
