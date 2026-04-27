/**
 * Domain entity: an active or recorded session of mcap capture.
 */
export type RecordingStateName =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "finalizing"
  | "unavailable";

export interface ActiveRecording {
  patrolId: string;
  recordingId: string;
  company: string;
  device: string;
  startedAt: string;
  comment: string;
  outputDir: string;
  cameraAck: boolean;
  mcapRunning: boolean;
}

export interface RecordingProgress {
  total: number;
  counts: Record<string, number>;
}

export interface RecordingStatus {
  state: RecordingStateName;
  active: ActiveRecording | null;
  progress: RecordingProgress;
}
