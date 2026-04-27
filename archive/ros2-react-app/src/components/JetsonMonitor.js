import { useState, useEffect, useRef } from 'react';
import ROSLIB from 'roslib';

export const JetsonMonitor = ({ jetsonHost, connected }) => {
  const [topics, setTopics] = useState([]);
  const [watching, setWatching] = useState({});
  const [rates, setRates] = useState({});
  const countersRef = useRef({});
  const subsRef = useRef({});
  const rosRef = useRef(null);

  useEffect(() => {
    if (!connected) return;
    const ros = new ROSLIB.Ros({ url: `ws://${jetsonHost}:9090` });
    rosRef.current = ros;
    ros.on('connection', () => {
      ros.getTopics((result) => {
        setTopics(result.topics.map((name, i) => ({ name, type: result.types[i] })));
      });
    });
    ros.on('error', () => {});
    const iv = setInterval(() => {
      if (ros.isConnected) ros.getTopics((r) => setTopics(r.topics.map((n, i) => ({ name: n, type: r.types[i] }))));
    }, 5000);
    // FPS counter
    const fpsIv = setInterval(() => {
      const r = {};
      for (const [k, v] of Object.entries(countersRef.current)) { r[k] = v; countersRef.current[k] = 0; }
      setRates(r);
    }, 1000);
    return () => { clearInterval(iv); clearInterval(fpsIv); Object.values(subsRef.current).forEach(s => s.unsubscribe()); ros.close(); };
  }, [connected, jetsonHost]);

  const toggleWatch = (topic) => {
    const ros = rosRef.current;
    if (!ros) return;
    if (subsRef.current[topic.name]) {
      subsRef.current[topic.name].unsubscribe();
      delete subsRef.current[topic.name];
      setWatching(p => { const n = { ...p }; delete n[topic.name]; return n; });
      return;
    }
    const sub = new ROSLIB.Topic({ ros, name: topic.name, messageType: topic.type });
    countersRef.current[topic.name] = 0;
    sub.subscribe(() => { countersRef.current[topic.name] = (countersRef.current[topic.name] || 0) + 1; });
    subsRef.current[topic.name] = sub;
    setWatching(p => ({ ...p, [topic.name]: true }));
  };

  return (
    <div style={st.container}>
      <div style={st.section}>
        <div style={st.sectionHeader}>
          <span style={st.sectionTitle}>Jetson Topics</span>
          <span style={st.badge}>{topics.length} topics</span>
        </div>
        <div style={st.list}>
          {topics.map(t => (
            <div key={t.name} style={st.row(!!watching[t.name])}>
              <button style={st.watchBtn(!!watching[t.name])} onClick={() => toggleWatch(t)}>
                {watching[t.name] ? '●' : '○'}
              </button>
              <div style={st.info}>
                <div style={st.topicName}>{t.name}</div>
                <div style={st.topicType}>{t.type}</div>
              </div>
              {watching[t.name] && (
                <span style={st.rate}>{rates[t.name] || 0} Hz</span>
              )}
            </div>
          ))}
          {topics.length === 0 && <div style={st.empty}>No topics — is rosbridge running?</div>}
        </div>
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
  list: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 500, overflowY: 'auto' },
  row: (active) => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
    background: active ? '#6c5ce708' : '#0d0d14', borderRadius: 8,
    border: active ? '1px solid #6c5ce722' : '1px solid transparent',
  }),
  watchBtn: (on) => ({
    background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', flexShrink: 0,
    color: on ? '#00d26a' : '#444',
  }),
  info: { flex: 1, minWidth: 0 },
  topicName: { fontSize: 12, fontWeight: 500, color: '#e0e0e6', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  topicType: { fontSize: 10, color: '#555', marginTop: 1 },
  rate: { fontSize: 11, fontWeight: 700, color: '#00d26a', flexShrink: 0 },
  empty: { padding: 20, textAlign: 'center', color: '#555', fontSize: 12 },
};
