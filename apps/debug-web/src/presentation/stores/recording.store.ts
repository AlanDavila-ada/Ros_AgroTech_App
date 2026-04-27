import { create } from "zustand";
import type { RecordingStatus } from "../../domain/entities/recording";

interface RecordingState {
  status: RecordingStatus;
  setStatus(status: RecordingStatus): void;
  reset(): void;
}

const empty: RecordingStatus = {
  state: "unavailable",
  active: null,
  progress: { total: 0, counts: {} },
};

export const useRecordingStore = create<RecordingState>((set) => ({
  status: empty,
  setStatus: (status) => set({ status }),
  reset: () => set({ status: empty }),
}));
