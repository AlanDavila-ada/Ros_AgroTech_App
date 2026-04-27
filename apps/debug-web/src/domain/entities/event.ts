/**
 * Domain entity: a single line in the JSONL event log.
 */
export type EventLevel = "debug" | "info" | "warning" | "error";
export type EventSource =
  | "bridge"
  | "frontend"
  | "ros2"
  | "mcap_recorder"
  | "calibration";

export interface EventRecord {
  ts: string;
  level: EventLevel;
  source: EventSource;
  kind: string;
  patrolId?: string;
  recordingId?: string;
  message?: string;
  meta?: Record<string, unknown>;
}
