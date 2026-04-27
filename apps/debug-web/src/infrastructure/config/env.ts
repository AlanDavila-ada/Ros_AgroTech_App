/**
 * Environment configuration. Mirrors mobile-hub/src/infrastructure/config/env.ts
 * so the debug client and mobile client agree on defaults.
 */
export const ENV = {
  EDGE_DEFAULT_HOST: "10.42.0.1",
  EDGE_DEFAULT_PORT: 8000,

  ROSBRIDGE_DEFAULT_PORT: 9090,

  API_TIMEOUT: 10_000,
  HEALTH_CHECK_INTERVAL: 5_000,
} as const;

export function buildBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

export function buildWsUrl(host: string, port: number): string {
  return `ws://${host}:${port}/ws`;
}

export function buildRosbridgeUrl(host: string, port: number = ENV.ROSBRIDGE_DEFAULT_PORT): string {
  return `ws://${host}:${port}`;
}
