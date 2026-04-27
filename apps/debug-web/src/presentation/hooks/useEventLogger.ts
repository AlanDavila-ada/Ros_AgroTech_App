import { useCallback, useEffect } from "react";
import type { DeviceConnection } from "./useDeviceConnection";
import { useEventsStore } from "../stores/events.store";

/**
 * Subscribes to the FastAPI event stream over WS and refreshes the events
 * store on every status broadcast. Returns helpers to append events from the
 * client and to refresh the list manually.
 */
export function useEventLogger(conn: DeviceConnection) {
  const setEvents = useEventsStore((s) => s.setEvents);
  const pushEvent = useEventsStore((s) => s.push);

  const refresh = useCallback(async () => {
    const events = await conn.eventRepo.list({ limit: 200 });
    setEvents(events);
  }, [conn, setEvents]);

  // Refresh once on mount + whenever a status frame arrives (cheap).
  useEffect(() => {
    refresh().catch(() => undefined);
    const off = conn.ws.onEvent((envelope) => {
      if (envelope.type === "status") return; // too chatty to refresh on
      // Domain events from the engine are emitted as their own envelope types
      // (e.g. recording.starting, mcap_recorder.recording). When one arrives,
      // pull a fresh slice rather than diffing locally.
      refresh().catch(() => undefined);
    });
    return () => off();
  }, [conn, refresh]);

  const append = useCallback(
    async (kind: string, message?: string, meta?: Record<string, unknown>) => {
      await conn.eventRepo.append({
        level: "info",
        source: "frontend",
        kind,
        message,
        meta,
      });
      // Optimistic local push so the UI updates instantly
      pushEvent({
        ts: new Date().toISOString(),
        level: "info",
        source: "frontend",
        kind,
        message,
        meta,
      });
    },
    [conn, pushEvent],
  );

  return { append, refresh };
}
