import { useEffect, useState } from "react";
import { useEventLogger } from "../hooks/useEventLogger";
import { useEventsStore } from "../stores/events.store";
import type { DeviceConnection } from "../hooks/useDeviceConnection";
import type { EventLevel, EventSource } from "../../domain/entities/event";

interface Props {
  conn: DeviceConnection;
}

const LEVEL_COLORS: Record<EventLevel, string> = {
  debug: "#94a3b8",
  info: "#0f172a",
  warning: "#b45309",
  error: "#b91c1c",
};

const SOURCES: EventSource[] = [
  "bridge",
  "frontend",
  "ros2",
  "mcap_recorder",
  "calibration",
];
const LEVELS: EventLevel[] = ["debug", "info", "warning", "error"];

export function EventLogPanel({ conn }: Props) {
  const { refresh } = useEventLogger(conn);
  const events = useEventsStore((s) => s.events);
  const [sourceFilter, setSourceFilter] = useState<EventSource | "">("");
  const [levelFilter, setLevelFilter] = useState<EventLevel | "">("");

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const filtered = events.filter(
    (e) =>
      (!sourceFilter || e.source === sourceFilter) &&
      (!levelFilter || e.level === levelFilter),
  );

  return (
    <section style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Events</h2>
        <span style={{ flex: 1 }} />
        <label>
          source{" "}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as EventSource | "")}
          >
            <option value="">all</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          level{" "}
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as EventLevel | "")}
          >
            <option value="">all</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void refresh()}>Refresh</button>
      </div>

      <div
        style={{
          maxHeight: 360,
          overflow: "auto",
          border: "1px solid #e5e7eb",
          borderRadius: 4,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 12,
        }}
      >
        {filtered.length === 0 && (
          <p style={{ padding: 16, color: "#64748b", margin: 0 }}>
            No events. Start a recording or trigger the backend.
          </p>
        )}
        {filtered.map((e, i) => (
          <div
            key={`${e.ts}-${i}`}
            style={{
              padding: "4px 8px",
              borderBottom: "1px solid #f1f5f9",
              color: LEVEL_COLORS[e.level],
            }}
          >
            <span style={{ color: "#94a3b8" }}>{e.ts}</span>{" "}
            <strong>[{e.source}]</strong> <span>{e.kind}</span>
            {e.message && <span> — {e.message}</span>}
            {e.patrolId && (
              <span style={{ color: "#64748b" }}> patrol={e.patrolId}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
