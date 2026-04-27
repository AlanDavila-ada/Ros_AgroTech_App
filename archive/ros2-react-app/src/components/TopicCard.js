import { useState, useEffect, useRef } from 'react';
import ROSLIB from 'roslib';

const MAX_MESSAGES = 50;

export const TopicCard = ({ ros, topicName, messageType, onRemove }) => {
  const [messages, setMessages] = useState([]);
  const [paused, setPaused] = useState(false);
  const [msgCount, setMsgCount] = useState(0);
  const scrollRef = useRef(null);
  const pausedRef = useRef(false);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    if (!ros) return;
    const listener = new ROSLIB.Topic({ ros, name: topicName, messageType });
    listener.subscribe((msg) => {
      setMsgCount((c) => c + 1);
      if (!pausedRef.current) {
        setMessages((prev) => [...prev.slice(-(MAX_MESSAGES - 1)), { data: msg, ts: Date.now() }]);
      }
    });
    return () => listener.unsubscribe();
  }, [ros, topicName, messageType]);

  useEffect(() => {
    if (scrollRef.current && !paused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, paused]);

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div>
          <div style={styles.cardTitle}>{topicName}</div>
          <div style={styles.cardType}>{messageType}</div>
        </div>
        <div style={styles.cardActions}>
          <span style={styles.msgCount}>{msgCount} msgs</span>
          <button onClick={() => setPaused(!paused)} style={styles.actionBtn}>
            {paused ? '▶' : '⏸'}
          </button>
          <button onClick={() => setMessages([])} style={styles.actionBtn}>⟲</button>
          <button onClick={onRemove} style={{ ...styles.actionBtn, color: '#ff4757' }}>✕</button>
        </div>
      </div>
      <div style={styles.liveBar}>
        <div style={styles.liveDot(paused)} />
        <span style={styles.liveText}>{paused ? 'PAUSED' : 'LISTENING'}</span>
      </div>
      <div ref={scrollRef} style={styles.messageArea}>
        {messages.length === 0 ? (
          <div style={styles.waiting}>Waiting for messages...</div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={styles.msgRow}>
              <span style={styles.msgTs}>
                {new Date(m.ts).toLocaleTimeString('en-US', { hour12: false })}
              </span>
              <pre style={styles.msgData}>{JSON.stringify(m.data, null, 2)}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const styles = {
  card: {
    background: '#111118',
    border: '1px solid #1e1e2a',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    maxHeight: 420,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '14px 16px 8px',
  },
  cardTitle: { fontSize: 14, fontWeight: 600 },
  cardType: { fontSize: 10, color: '#666', marginTop: 2 },
  cardActions: { display: 'flex', alignItems: 'center', gap: 6 },
  msgCount: { fontSize: 10, color: '#6c5ce7', marginRight: 4 },
  actionBtn: {
    background: '#1a1a24',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    color: '#888',
    width: 28,
    height: 28,
    cursor: 'pointer',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 16px 10px',
  },
  liveDot: (paused) => ({
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: paused ? '#ffa502' : '#00d26a',
    boxShadow: paused ? 'none' : '0 0 6px #00d26a88',
  }),
  liveText: { fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: '1.5px' },
  messageArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '0 12px 12px',
    fontSize: 12,
  },
  waiting: { color: '#444', padding: 16, textAlign: 'center', fontSize: 12 },
  msgRow: {
    display: 'flex',
    gap: 10,
    padding: '6px 8px',
    borderBottom: '1px solid #1a1a24',
    alignItems: 'flex-start',
  },
  msgTs: { color: '#555', fontSize: 10, whiteSpace: 'nowrap', paddingTop: 2 },
  msgData: {
    margin: 0,
    color: '#c0c0cc',
    fontSize: 11,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    flex: 1,
  },
};
