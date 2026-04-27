import type {
  ActiveRecording,
  RecordingProgress,
  RecordingStatus,
  RecordingStateName,
} from "../../domain/entities/recording";

const VALID_STATES: RecordingStateName[] = [
  "idle",
  "starting",
  "recording",
  "stopping",
  "finalizing",
  "unavailable",
];

function toState(value: unknown): RecordingStateName {
  return typeof value === "string" && (VALID_STATES as string[]).includes(value)
    ? (value as RecordingStateName)
    : "unavailable";
}

export function mapRecordingStatus(dto: Record<string, unknown> | null | undefined): RecordingStatus {
  if (!dto) {
    return { state: "unavailable", active: null, progress: { total: 0, counts: {} } };
  }
  const state = toState(dto.state);
  const activeDto = dto.active as Record<string, unknown> | null | undefined;
  const active: ActiveRecording | null = activeDto
    ? {
        patrolId: String(activeDto.patrol_id ?? ""),
        recordingId: String(activeDto.recording_id ?? ""),
        company: String(activeDto.company ?? ""),
        device: String(activeDto.device ?? ""),
        startedAt: String(activeDto.started_at ?? ""),
        comment: String(activeDto.comment ?? ""),
        outputDir: String(activeDto.output_dir ?? ""),
        cameraAck: Boolean(activeDto.camera_ack),
        mcapRunning: Boolean(activeDto.mcap_running),
      }
    : null;
  const progressDto = dto.mcap_progress as Record<string, unknown> | undefined;
  const progress: RecordingProgress = {
    total: Number(progressDto?.total ?? 0),
    counts: (progressDto?.counts as Record<string, number>) ?? {},
  };
  return { state, active, progress };
}
