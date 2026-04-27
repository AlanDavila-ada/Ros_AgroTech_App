import { useEffect, useRef, useCallback } from 'react';
import { apiLog } from '../apiSsh';

const buffer = [];
let flushTimer = null;
let inFlight = false;

const FLUSH_INTERVAL_MS = 2000;
const MAX_BUFFER = 200;

let context = { customer: null, device: null, patrol: null, recording: null };

export function setLoggerContext(next) { context = { ...context, ...next }; }
export function clearLoggerContext(keys) { for (const k of keys) context[k] = null; }

const drainAndFlush = async (host) => {
  if (inFlight || buffer.length === 0) return;
  inFlight = true;
  const chunk = buffer.splice(0, buffer.length);
  try {
    await apiLog(chunk, host);
  } catch {
    buffer.unshift(...chunk);
    while (buffer.length > MAX_BUFFER) buffer.shift();
  } finally {
    inFlight = false;
  }
};

const scheduleFlush = (host) => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; drainAndFlush(host); }, FLUSH_INTERVAL_MS);
};

export function logEvent(level, event, meta, opts = {}) {
  const e = {
    ts: new Date().toISOString(),
    level,
    source: opts.source || 'frontend',
    event,
    ...(context.customer ? { customer: context.customer } : {}),
    ...(context.device ? { device: context.device } : {}),
    ...(context.patrol ? { patrol: context.patrol } : {}),
    ...(context.recording ? { recording: context.recording } : {}),
    ...(meta ? { meta } : {}),
  };
  buffer.push(e);
  while (buffer.length > MAX_BUFFER) buffer.shift();
  if (level === 'error' && opts.host) drainAndFlush(opts.host);
  else if (opts.host) scheduleFlush(opts.host);
}

export function useEventLogger(host) {
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    const iv = setInterval(() => { if (hostRef.current) drainAndFlush(hostRef.current); }, FLUSH_INTERVAL_MS);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const onError = (e) => {
      logEvent('error', 'window.error', {
        message: e.message, source: e.filename, line: e.lineno, col: e.colno,
        stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 2000) : undefined,
      }, { host: hostRef.current });
    };
    const onRejection = (e) => {
      const reason = e.reason && (e.reason.stack || e.reason.message || e.reason);
      logEvent('error', 'window.unhandled_rejection', { reason: String(reason).slice(0, 2000) }, { host: hostRef.current });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const log = useCallback((level, event, meta) => {
    logEvent(level, event, meta, { host: hostRef.current });
  }, []);

  return log;
}
