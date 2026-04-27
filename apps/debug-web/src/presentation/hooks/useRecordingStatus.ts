import { useRecordingStore } from "../stores/recording.store";

export function useRecordingStatus() {
  return useRecordingStore((s) => s.status);
}
