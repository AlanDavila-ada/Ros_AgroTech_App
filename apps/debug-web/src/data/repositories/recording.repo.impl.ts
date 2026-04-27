import type { RecordingRepository } from "../../domain/repositories/recording.repo";
import type { RecordingStatus } from "../../domain/entities/recording";
import { mapRecordingStatus } from "../mappers/recording.mapper";
import { EdgeApiClient } from "../sources/edge/edge-api.client";

export class RecordingRepositoryImpl implements RecordingRepository {
  constructor(private readonly api: EdgeApiClient) {}

  async status(): Promise<RecordingStatus> {
    const dto = await this.api.recordingStatus();
    return mapRecordingStatus(dto);
  }

  async start(args: {
    company: string;
    device: string;
    patrolId: string;
    recordingId: string;
    topics: string;
    comment?: string;
  }): Promise<{ message: string; data: unknown }> {
    const res = await this.api.startRecording({
      company: args.company,
      device: args.device,
      patrol_id: args.patrolId,
      recording_id: args.recordingId,
      topics: args.topics,
      comment: args.comment,
    });
    return { message: String(res.message ?? ""), data: res.data };
  }

  async stop(reason?: string): Promise<{ message: string; data: unknown }> {
    const res = await this.api.stopRecording({ reason });
    return { message: String(res.message ?? ""), data: res.data };
  }
}
