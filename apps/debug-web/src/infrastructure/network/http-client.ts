/**
 * HTTP client factory. Mirrors mobile-hub's pattern.
 */
import axios, { type AxiosError, type AxiosInstance } from "axios";
import { ENV } from "../config/env";

export interface ApiError {
  message: string;
  code: string;
  status: number;
}

export type ErrorHandler = (error: ApiError) => void;

let globalErrorHandler: ErrorHandler | null = null;

export function setGlobalErrorHandler(handler: ErrorHandler | null): void {
  globalErrorHandler = handler;
}

export function createHttpClient(baseURL: string): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: ENV.API_TIMEOUT,
    headers: { "Content-Type": "application/json" },
  });

  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      const apiError: ApiError = {
        message: error.message || "An error occurred",
        code: error.code || "UNKNOWN_ERROR",
        status: error.response?.status ?? 0,
      };
      const data = error.response?.data;
      if (data && typeof data === "object") {
        const detail = (data as Record<string, unknown>).detail;
        const message = (data as Record<string, unknown>).message;
        if (typeof detail === "string") apiError.message = detail;
        else if (typeof message === "string") apiError.message = message;
      }
      if (globalErrorHandler) globalErrorHandler(apiError);
      return Promise.reject(apiError);
    },
  );

  return client;
}
