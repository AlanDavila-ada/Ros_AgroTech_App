import { useEffect, useState, useRef, useCallback } from 'react';
import ROSLIB from 'roslib';

// Single source of truth for whether the Jetson is recording.
// Subscribes to /recording/status (published by camera_node.py) and parses it.
// camStatus shape: { state: 'recording'|'idle', elapsed, total, counts, dir }
// We also surface a `pending` flag so the UI doesn't flicker during the start-ack window.

const STALE_AFTER_MS = 4000; // if no message in this long, treat as stale

export function useRecordingStatus(ros, connected) {
  const [status, setStatus] = useState({ state: 'idle' });
  const [pending, setPending] = useState(null); // 'start' | 'stop' | null
  const [stale, setStale] = useState(false);
  // Last-known ids while recording — preserved across the transition to idle
  // so listeners (e.g. RecordingsView) can highlight the just-finished recording.
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
          const p = String(parsed.dir).split('/').filter(Boolean);
          if (p.length >= 5) setLastIds({ customer: p[1], device: p[2], patrol: p[3], recording: p[4] });
        }
        // Clear pending intent once the topic confirms the new state.
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

  // Derived: "actively recording" if the topic says so OR we're mid start-ack.
  const active = status.state === 'recording' || pending === 'start';
  const elapsed = status.state === 'recording' ? Math.floor(status.elapsed || 0) : 0;
  const totalFrames = status.state === 'recording' ? (status.total || 0) : 0;
  const dir = status.dir || '';
  // dir format: /AgroTech_recordings/{customer}/{device}/{patrol}/{recording}
  const parts = dir.split('/').filter(Boolean);
  const ids = parts.length >= 5
    ? { customer: parts[1], device: parts[2], patrol: parts[3], recording: parts[4] }
    : null;

  const markPending = useCallback((kind) => setPending(kind), []);

  return { active, elapsed, totalFrames, ids, lastIds, status, pending, stale, markPending };
}
