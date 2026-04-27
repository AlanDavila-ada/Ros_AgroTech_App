import type { EventRecord } from "../entities/event";

export interface EventRepository {
  list(query?: {
    patrolId?: string;
    recordingId?: string;
    source?: string;
    level?: string;
    kind?: string;
    limit?: number;
  }): Promise<EventRecord[]>;
  append(event: {
    level?: string;
    source?: string;
    kind: string;
    patrolId?: string;
    recordingId?: string;
    message?: string;
    meta?: Record<string, unknown>;
  }): Promise<void>;
}
