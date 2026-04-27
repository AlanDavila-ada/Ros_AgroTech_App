/**
 * Domain entities: device identity and health.
 */
export interface DeviceIdentity {
  deviceId: string;
  org: string;
  tenant: string;
  env: string;
}

export interface ServerVersion {
  version: string;
  name: string;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
}
