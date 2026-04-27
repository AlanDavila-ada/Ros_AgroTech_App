import type { RecordingStatus } from "../entities/recording";

export interface RecordingRepository {
  status(): Promise<RecordingStatus>;
  start(args: {
    company: string;
    device: string;
    patrolId: string;
    recordingId: string;
    topics: string;
    comment?: string;
  }): Promise<{ message: string; data: unknown }>;
  stop(reason?: string): Promise<{ message: string; data: unknown }>;
}
