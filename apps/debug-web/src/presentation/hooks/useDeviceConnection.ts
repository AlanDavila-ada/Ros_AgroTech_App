import { useEffect, useMemo, useRef } from "react";
import { EdgeApiClient } from "../../data/sources/edge/edge-api.client";
import { EventRepositoryImpl } from "../../data/repositories/event.repo.impl";
import { RecordingRepositoryImpl } from "../../data/repositories/recording.repo.impl";
import {
  buildWsUrl,
  ENV,
} from "../../infrastructure/config/env";
import {
  createWebSocketClient,
  type WsClient,
} from "../../infrastructure/network/ws-client";
import { mapRecordingStatus } from "../../data/mappers/recording.mapper";
import { useConnectionStore } from "../stores/connection.store";
import { useRecordingStore } from "../stores/recording.store";

export interface DeviceConnection {
  api: EdgeApiClient;
  recordingRepo: RecordingRepositoryImpl;
  eventRepo: EventRepositoryImpl;
  ws: WsClient;
}

/**
 * Materializes the API client + repos + WS for the currently configured
 * (host, port). Recreated whenever the endpoint changes.
 *
 * Wires the WS to:
 *   - status frames → recording store
 *   - lifecycle → connection store
 *
 * Health probe runs on mount and on a HEALTH_CHECK_INTERVAL timer.
 */
export function useDeviceConnection(): DeviceConnection {
  const host = useConnectionStore((s) => s.host);
  const port = useConnectionStore((s) => s.port);
  const setStatus = useConnectionStore((s) => s.setStatus);
  const setRecording = useRecordingStore((s) => s.setStatus);

  const conn = useMemo<DeviceConnection>(() => {
    const api = new EdgeApiClient(host, port);
    const recordingRepo = new RecordingRepositoryImpl(api);
    const eventRepo = new EventRepositoryImpl(api);
    const ws = createWebSocketClient(buildWsUrl(host, port));
    return { api, recordingRepo, eventRepo, ws };
  }, [host, port]);

  // Track latest setters via refs so the effect doesn't re-run on every render
  const setStatusRef = useRef(setStatus);
  const setRecordingRef = useRef(setRecording);
  setStatusRef.current = setStatus;
  setRecordingRef.current = setRecording;

  useEffect(() => {
    const offState = conn.ws.onState((state) => {
      switch (state) {
        case "open":
          setStatusRef.current("connected");
          break;
        case "connecting":
          setStatusRef.current("connecting");
          break;
        case "error":
          setStatusRef.current("error", "WebSocket error");
          break;
        case "closed":
          setStatusRef.current("disconnected");
          break;
      }
    });

    const offEvent = conn.ws.onEvent((envelope) => {
      if (envelope.type === "status" || envelope.type === "connected") {
        const recording = (envelope.data as Record<string, unknown>).recording as
          | Record<string, unknown>
          | undefined;
        setRecordingRef.current(mapRecordingStatus(recording));
      }
    });

    let disposed = false;
    const probe = async () => {
      try {
        await conn.api.health();
        if (!disposed) setStatusRef.current("connected");
      } catch {
        if (!disposed) setStatusRef.current("error", "health check failed");
      }
    };
    probe();
    const t = window.setInterval(probe, ENV.HEALTH_CHECK_INTERVAL);

    return () => {
      disposed = true;
      window.clearInterval(t);
      offState();
      offEvent();
      conn.ws.close();
    };
  }, [conn]);

  return conn;
}
