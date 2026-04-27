import { useState } from "react";
import { useConnectionStore } from "../stores/connection.store";

const dotStyle = (color: string) => ({
  display: "inline-block",
  width: 10,
  height: 10,
  borderRadius: "50%",
  backgroundColor: color,
  marginRight: 8,
});

const STATUS_COLORS: Record<string, string> = {
  connected: "#22c55e",
  connecting: "#eab308",
  disconnected: "#9ca3af",
  error: "#ef4444",
};

export function ConnectBar() {
  const host = useConnectionStore((s) => s.host);
  const port = useConnectionStore((s) => s.port);
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const setEndpoint = useConnectionStore((s) => s.setEndpoint);

  const [hostInput, setHostInput] = useState(host);
  const [portInput, setPortInput] = useState(String(port));

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        background: "#0f172a",
        color: "#e2e8f0",
        borderBottom: "1px solid #1e293b",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <span title={status}>
        <span style={dotStyle(STATUS_COLORS[status] ?? "#9ca3af")} />
        {status}
        {error && <span style={{ marginLeft: 8, color: "#ef4444" }}>({error})</span>}
      </span>
      <span style={{ flex: 1 }} />
      <label>
        host{" "}
        <input
          value={hostInput}
          onChange={(e) => setHostInput(e.target.value)}
          style={{ width: 140 }}
        />
      </label>
      <label>
        port{" "}
        <input
          value={portInput}
          onChange={(e) => setPortInput(e.target.value)}
          style={{ width: 60 }}
        />
      </label>
      <button
        onClick={() => {
          const p = Number(portInput) || 8000;
          setEndpoint(hostInput.trim(), p);
        }}
      >
        Apply
      </button>
    </div>
  );
}
