import { useEffect, useState, useRef, useCallback } from 'react';
import ROSLIB from 'roslib';

const STALE_AFTER_MS = 4000;

export function useRecordingStatus(ros, connected) {
  const [status, setStatus] = useState({ state: 'idle' });
  const [pending, setPending] = useState(null);
  const [stale, setStale] = useState(false);
  const [lastIds, setLastIds] = useState(null);
  const lastMsgRef = useRef(0);

  useEffect(() => {
    if (!ros || !connected) { setStatus({ state: 'idle' }); return; }
    const sub = new ROSLIB.Topic({ ros, name: '/recording/status', messageType: 'std_msgs/String' });
    sub.subscribe((msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        setStatus(parsed);
        lastMsgRef.current = Date.now();
        setStale(false);
        if (parsed.dir) {
          const parts = String(parsed.dir).split('/').filter(Boolean);
          if (parts.length >= 5) setLastIds({ customer: parts[1], device: parts[2], patrol: parts[3], recording: parts[4] });
        }
        setPending((p) => {
          if (p === 'start' && parsed.state === 'recording') return null;
          if (p === 'stop' && parsed.state === 'idle') return null;
          return p;
        });
      } catch {}
    });
    const iv = setInterval(() => {
      if (lastMsgRef.current && Date.now() - lastMsgRef.current > STALE_AFTER_MS) {
        setStale(true);
      }
    }, 1000);
    return () => { sub.unsubscribe(); clearInterval(iv); };
  }, [ros, connected]);

  const active = status.state === 'recording' || pending === 'start';
  const elapsed = status.state === 'recording' ? Math.floor(status.elapsed || 0) : 0;
  const totalFrames = status.state === 'recording' ? (status.total || 0) : 0;
  const dir = status.dir || '';
  const parts = dir.split('/').filter(Boolean);
  const ids = parts.length >= 5
    ? { customer: parts[1], device: parts[2], patrol: parts[3], recording: parts[4] }
    : null;

  const markPending = useCallback((kind) => setPending(kind), []);

  return { active, elapsed, totalFrames, ids, lastIds, status, pending, stale, markPending };
}
