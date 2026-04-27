import { useState, useEffect } from 'react';

export const Sidebar = ({
  ros, connected, view, onViewChange,
  jetsonHost, onJetsonHostChange, jetsonPort, onJetsonPortChange,
  domainId, onDomainIdChange,
  localConnected, jetsonConnected,
  recordingActive,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div style={st.collapsedBar}>
        <button onClick={() => setCollapsed(false)} style={st.expandBtn}>☰</button>
        <div style={st.dotSmall(localConnected)} title="Local" />
        <div style={st.dotSmall(jetsonConnected)} title="Jetson" />
      </div>
    );
  }

  return (
    <aside style={st.sidebar}>
      <div style={st.header}>
        <div style={st.brand}>
          <span style={st.logo}>◈</span>
          <span style={st.title}>AgroTech</span>
        </div>
        <button onClick={() => setCollapsed(true)} style={st.collapseBtn}>✕</button>
      </div>

      {/* Connection status */}
      <div style={st.connPanel}>
        <div style={st.connRow}>
          <div style={st.dot(localConnected)} />
          <span style={st.connLabel}>Local</span>
          <span style={st.connUrl}>ws://localhost:9090</span>
        </div>
        <div style={st.connRow}>
          <div style={st.dot(jetsonConnected)} />
          <span style={st.connLabel}>Jetson</span>
          <span style={st.connUrl}>ws://{jetsonHost}:{jetsonPort}</span>
        </div>
        <div style={st.connFields}>
          <input style={st.connInput} value={jetsonHost} onChange={(e) => onJetsonHostChange(e.target.value)} placeholder="Jetson IP" />
          <input style={{ ...st.connInput, width: 60, flexShrink: 0 }} value={jetsonPort} onChange={(e) => onJetsonPortChange(e.target.value)} placeholder="Port" />
        </div>
        <div style={{ ...st.connFields, marginTop: 2 }}>
          <span style={{ fontSize: 10, color: '#555', width: 68, flexShrink: 0 }}>Domain ID</span>
          <input style={{ ...st.connInput, width: 60, flexShrink: 0 }} value={domainId} onChange={(e) => onDomainIdChange(e.target.value)} placeholder="42" />
        </div>
      </div>

      {/* Main navigation */}
      <div style={st.navSection}>
        <div style={st.navLabel}>VIEWS</div>
        <button style={st.navItem(view === 'local')} onClick={() => onViewChange('local')}>
          <span style={st.navIcon}>💻</span>
          <div>
            <div style={st.navTitle}>Local</div>
            <div style={st.navDesc}>Monitor & Publish</div>
          </div>
          <div style={st.navDot(localConnected)} />
        </button>
        <button style={st.navItem(view === 'jetson', recordingActive)} onClick={() => onViewChange('jetson')}>
          <span style={st.navIcon}>📡</span>
          <div>
            <div style={st.navTitle}>Jetson</div>
            <div style={st.navDesc}>{recordingActive ? <span style={{ color: '#ff4757', fontWeight: 700 }}>● Recording</span> : 'Cameras, Recording & Data'}</div>
          </div>
          <div style={st.navDot(jetsonConnected)} />
        </button>
      </div>

      <div style={st.footer}>
        <span style={st.footerText}>Adalabs × Orza Tech</span>
      </div>
    </aside>
  );
};

const st = {
  sidebar: { width: 260, minWidth: 260, background: '#111118', borderRight: '1px solid #1e1e2a', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  collapsedBar: { width: 48, minWidth: 48, background: '#111118', borderRight: '1px solid #1e1e2a', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16, gap: 12 },
  expandBtn: { background: 'none', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 16px 12px' },
  brand: { display: 'flex', alignItems: 'center', gap: 8 },
  logo: { fontSize: 22, color: '#6c5ce7' },
  title: { fontSize: 16, fontWeight: 700, letterSpacing: '0.5px' },
  collapseBtn: { background: 'none', border: 'none', color: '#555', fontSize: 14, cursor: 'pointer' },

  connPanel: { padding: '0 12px 16px', borderBottom: '1px solid #1e1e2a', display: 'flex', flexDirection: 'column', gap: 6 },
  connRow: { display: 'flex', alignItems: 'center', gap: 8 },
  connLabel: { fontSize: 11, fontWeight: 600, color: '#aaa', width: 44 },
  connUrl: { fontSize: 10, color: '#555', fontFamily: 'monospace' },
  connFields: { display: 'flex', gap: 4, marginTop: 4 },
  connInput: { flex: 1, padding: '6px 8px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, color: '#ccc', fontSize: 11, outline: 'none', boxSizing: 'border-box' },
  dot: (on) => ({ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: on ? '#00d26a' : '#ff4757', boxShadow: on ? '0 0 8px #00d26a88' : 'none' }),
  dotSmall: (on) => ({ width: 8, height: 8, borderRadius: '50%', background: on ? '#00d26a' : '#ff4757' }),

  navSection: { flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4 },
  navLabel: { fontSize: 10, fontWeight: 700, color: '#555', letterSpacing: '1.5px', marginBottom: 8, paddingLeft: 4 },
  navItem: (active, recording) => ({
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px', width: '100%',
    background: recording ? '#ff475710' : (active ? '#6c5ce712' : 'transparent'),
    border: `1px solid ${recording ? '#ff475744' : (active ? '#6c5ce733' : 'transparent')}`,
    borderRadius: 10, cursor: 'pointer', textAlign: 'left', color: '#e0e0e6', transition: 'all 0.15s',
  }),
  navIcon: { fontSize: 20, flexShrink: 0 },
  navTitle: { fontSize: 13, fontWeight: 700 },
  navDesc: { fontSize: 10, color: '#666', marginTop: 1 },
  navDot: (on) => ({ width: 6, height: 6, borderRadius: '50%', marginLeft: 'auto', flexShrink: 0, background: on ? '#00d26a' : '#333' }),

  footer: { padding: '12px 16px', borderTop: '1px solid #1e1e2a' },
  footerText: { fontSize: 10, color: '#333', letterSpacing: '0.5px' },
};
