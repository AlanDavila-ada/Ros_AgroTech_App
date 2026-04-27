/**
 * WebSocket client for the field_capture_v2 /ws endpoint.
 *
 * Reconnects on close with exponential backoff capped at 10 s. Emits typed
 * events to consumers via callbacks. Replaces the polling loops the legacy
 * server.js client used.
 */

export interface WsEnvelope {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export type WsEventHandler = (event: WsEnvelope) => void;
export type WsLifecycleHandler = (state: WsConnectionState) => void;

export type WsConnectionState = "connecting" | "open" | "closed" | "error";

export interface WsClient {
  url: string;
  state: WsConnectionState;
  onEvent(handler: WsEventHandler): () => void;
  onState(handler: WsLifecycleHandler): () => void;
  send(message: unknown): void;
  close(): void;
}

export function createWebSocketClient(url: string): WsClient {
  const eventHandlers = new Set<WsEventHandler>();
  const stateHandlers = new Set<WsLifecycleHandler>();
  let socket: WebSocket | null = null;
  let backoff = 250;
  let stopped = false;
  let state: WsConnectionState = "connecting";

  function setState(next: WsConnectionState): void {
    state = next;
    for (const h of stateHandlers) h(next);
  }

  function connect(): void {
    if (stopped) return;
    setState("connecting");
    socket = new WebSocket(url);

    socket.onopen = () => {
      backoff = 250;
      setState("open");
    };

    socket.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as WsEnvelope;
        for (const h of eventHandlers) h(parsed);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onerror = () => setState("error");

    socket.onclose = () => {
      setState("closed");
      if (!stopped) {
        const delay = Math.min(backoff, 10_000);
        backoff = Math.min(backoff * 2, 10_000);
        setTimeout(connect, delay);
      }
    };
  }

  connect();

  return {
    get url() {
      return url;
    },
    get state() {
      return state;
    },
    onEvent(handler) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    onState(handler) {
      stateHandlers.add(handler);
      return () => stateHandlers.delete(handler);
    },
    send(message) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(typeof message === "string" ? message : JSON.stringify(message));
      }
    },
    close() {
      stopped = true;
      socket?.close();
    },
  };
}
