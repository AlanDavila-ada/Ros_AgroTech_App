/**
 * EdgeApiClient — single typed client for field_capture_v2 FastAPI.
 *
 * Methods are thin: they call the route, return the parsed body, and let the
 * http-client interceptor surface errors as ApiError. Higher layers (data
 * repositories) wrap these into domain types.
 *
 * Once `npm run codegen` has produced `types.gen.ts`, request/response shapes
 * become exact. Until then, the client is hand-typed using the API surface
 * shipped in Phase B/C/E.
 */
import type { AxiosInstance } from "axios";
import { createHttpClient } from "../../../infrastructure/network/http-client";
import { buildBaseUrl } from "../../../infrastructure/config/env";

export interface StartRecordingRequest {
  company: string;
  device: string;
  patrol_id: string;
  recording_id: string;
  topics: string;
  comment?: string;
  base_dir?: string;
}

export interface StopRecordingRequest {
  reason?: string;
}

export interface AppendEventRequest {
  level?: string;
  source?: string;
  kind: string;
  patrol_id?: string;
  recording_id?: string;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface ListEventsQuery {
  patrol_id?: string;
  recording_id?: string;
  source?: string;
  level?: string;
  kind?: string;
  limit?: number;
}

export class EdgeApiClient {
  readonly host: string;
  readonly port: number;
  private readonly http: AxiosInstance;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
    this.http = createHttpClient(buildBaseUrl(host, port));
  }

  // System
  async health(): Promise<{ status: string }> {
    const res = await this.http.get("/system/health");
    return res.data;
  }

  async version(): Promise<{ version: string; name: string }> {
    const res = await this.http.get("/system/version");
    return res.data;
  }

  async identity(): Promise<{ device_id: string; org: string; tenant: string; env: string }> {
    const res = await this.http.get("/system/identity");
    return res.data;
  }

  // Recordings
  async recordingStatus(): Promise<Record<string, unknown>> {
    const res = await this.http.get("/recordings/status");
    return res.data;
  }

  async startRecording(body: StartRecordingRequest): Promise<Record<string, unknown>> {
    const res = await this.http.post("/recordings/start", body);
    return res.data;
  }

  async stopRecording(body: StopRecordingRequest = {}): Promise<Record<string, unknown>> {
    const res = await this.http.post("/recordings/stop", body);
    return res.data;
  }

  // Events
  async appendEvent(body: AppendEventRequest): Promise<{ success: boolean }> {
    const res = await this.http.post("/events", body);
    return res.data;
  }

  async appendEventsBatch(events: AppendEventRequest[]): Promise<{ success: boolean; count: number }> {
    const res = await this.http.post("/events/batch", { events });
    return res.data;
  }

  async listEvents(
    query: ListEventsQuery = {},
  ): Promise<{ events: Record<string, unknown>[]; count: number }> {
    const res = await this.http.get("/events", { params: query });
    return res.data;
  }
}
