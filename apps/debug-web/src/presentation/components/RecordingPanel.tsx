import { useState } from "react";
import { useRecordingStatus } from "../hooks/useRecordingStatus";
import type { DeviceConnection } from "../hooks/useDeviceConnection";

interface Props {
  conn: DeviceConnection;
}

export function RecordingPanel({ conn }: Props) {
  const status = useRecordingStatus();
  const [company, setCompany] = useState("adalabs");
  const [device, setDevice] = useState("dev01");
  const [patrolId, setPatrolId] = useState("");
  const [recordingId, setRecordingId] = useState("");
  const [topics, setTopics] = useState("/imu:sensor_msgs/msg/Imu");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const isIdle = status.state === "idle";
  const isBusy = busy || (!isIdle && status.state !== "unavailable");

  async function start() {
    if (!patrolId || !recordingId) {
      setLastError("patrol_id and recording_id are required");
      return;
    }
    setLastError(null);
    setBusy(true);
    try {
      await conn.recordingRepo.start({
        company,
        device,
        patrolId,
        recordingId,
        topics,
        comment,
      });
    } catch (e: unknown) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setLastError(null);
    setBusy(true);
    try {
      await conn.recordingRepo.stop("user");
    } catch (e: unknown) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      style={{
        padding: 16,
        borderBottom: "1px solid #e5e7eb",
        background: "#f8fafc",
      }}
    >
      <h2 style={{ margin: "0 0 8px" }}>Recording</h2>
      <p style={{ margin: "0 0 12px" }}>
        State: <strong>{status.state}</strong>
        {status.active && (
          <>
            {" · "}
            patrol={status.active.patrolId} · rec={status.active.recordingId} ·
            mcap_running={String(status.active.mcapRunning)} · camera_ack=
            {String(status.active.cameraAck)}
          </>
        )}
      </p>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "120px 1fr 120px 1fr" }}>
        <label>company</label>
        <input value={company} onChange={(e) => setCompany(e.target.value)} />
        <label>device</label>
        <input value={device} onChange={(e) => setDevice(e.target.value)} />
        <label>patrol_id</label>
        <input value={patrolId} onChange={(e) => setPatrolId(e.target.value)} />
        <label>recording_id</label>
        <input value={recordingId} onChange={(e) => setRecordingId(e.target.value)} />
        <label>topics</label>
        <input
          value={topics}
          onChange={(e) => setTopics(e.target.value)}
          style={{ gridColumn: "2 / span 3" }}
        />
        <label>comment</label>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          style={{ gridColumn: "2 / span 3" }}
        />
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button onClick={start} disabled={isBusy || !isIdle}>
          {isBusy && status.state === "starting" ? "Starting..." : "Start"}
        </button>
        <button onClick={stop} disabled={isBusy || isIdle || status.state === "unavailable"}>
          {status.state === "stopping" || status.state === "finalizing" ? "Stopping..." : "Stop"}
        </button>
        {status.progress.total > 0 && (
          <span style={{ alignSelf: "center" }}>
            mcap msgs: <strong>{status.progress.total}</strong>
          </span>
        )}
      </div>

      {lastError && (
        <p style={{ color: "#ef4444", marginTop: 8 }}>error: {lastError}</p>
      )}
    </section>
  );
}
