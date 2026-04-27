import { useDeviceConnection } from "./hooks/useDeviceConnection";
import { ConnectBar } from "./components/ConnectBar";
import { RecordingPanel } from "./components/RecordingPanel";
import { EventLogPanel } from "./components/EventLogPanel";

export default function App() {
  const conn = useDeviceConnection();

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      <ConnectBar />
      <main>
        <RecordingPanel conn={conn} />
        <EventLogPanel conn={conn} />
      </main>
      <footer
        style={{
          padding: "12px 16px",
          borderTop: "1px solid #e5e7eb",
          color: "#64748b",
          fontSize: 12,
        }}
      >
        field_capture_v2 debug client. The recording engine lives in
        adalabs-ai/devices-hub (workspaces/field_capture_v2). Mobile-hub is the
        primary client; this is for ops.
      </footer>
    </div>
  );
}
