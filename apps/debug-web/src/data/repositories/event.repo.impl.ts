import type { EventRecord } from "../../domain/entities/event";
import type { EventRepository } from "../../domain/repositories/event.repo";
import { mapEvent } from "../mappers/event.mapper";
import { EdgeApiClient, type ListEventsQuery } from "../sources/edge/edge-api.client";

export class EventRepositoryImpl implements EventRepository {
  constructor(private readonly api: EdgeApiClient) {}

  async list(query: {
    patrolId?: string;
    recordingId?: string;
    source?: string;
    level?: string;
    kind?: string;
    limit?: number;
  } = {}): Promise<EventRecord[]> {
    const apiQuery: ListEventsQuery = {
      patrol_id: query.patrolId,
      recording_id: query.recordingId,
      source: query.source,
      level: query.level,
      kind: query.kind,
      limit: query.limit,
    };
    const res = await this.api.listEvents(apiQuery);
    return res.events.map(mapEvent);
  }

  async append(event: {
    level?: string;
    source?: string;
    kind: string;
    patrolId?: string;
    recordingId?: string;
    message?: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    await this.api.appendEvent({
      level: event.level,
      source: event.source,
      kind: event.kind,
      patrol_id: event.patrolId,
      recording_id: event.recordingId,
      message: event.message,
      meta: event.meta,
    });
  }
}
