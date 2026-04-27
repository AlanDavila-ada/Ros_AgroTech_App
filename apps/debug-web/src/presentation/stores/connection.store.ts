import { create } from "zustand";
import { ENV } from "../../infrastructure/config/env";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface ConnectionState {
  host: string;
  port: number;
  status: ConnectionStatus;
  error?: string;
  setEndpoint(host: string, port: number): void;
  setStatus(status: ConnectionStatus, error?: string): void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  host: ENV.EDGE_DEFAULT_HOST,
  port: ENV.EDGE_DEFAULT_PORT,
  status: "disconnected",
  setEndpoint: (host, port) => set({ host, port, status: "disconnected", error: undefined }),
  setStatus: (status, error) => set({ status, error }),
}));
