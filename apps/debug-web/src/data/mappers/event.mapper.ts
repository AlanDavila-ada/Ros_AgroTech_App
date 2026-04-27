import type { EventLevel, EventRecord, EventSource } from "../../domain/entities/event";

const LEVELS: EventLevel[] = ["debug", "info", "warning", "error"];
const SOURCES: EventSource[] = ["bridge", "frontend", "ros2", "mcap_recorder", "calibration"];

export function mapEvent(dto: Record<string, unknown>): EventRecord {
  const level = (LEVELS as string[]).includes(String(dto.level))
    ? (dto.level as EventLevel)
    : "info";
  const source = (SOURCES as string[]).includes(String(dto.source))
    ? (dto.source as EventSource)
    : "bridge";
  return {
    ts: String(dto.ts ?? ""),
    level,
    source,
    kind: String(dto.kind ?? ""),
    patrolId: dto.patrol_id ? String(dto.patrol_id) : undefined,
    recordingId: dto.recording_id ? String(dto.recording_id) : undefined,
    message: dto.message ? String(dto.message) : undefined,
    meta: (dto.meta as Record<string, unknown>) ?? undefined,
  };
}
