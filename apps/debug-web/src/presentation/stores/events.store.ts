import { create } from "zustand";
import type { EventRecord } from "../../domain/entities/event";

const MAX_EVENTS = 500;

interface EventsState {
  events: EventRecord[];
  setEvents(events: EventRecord[]): void;
  push(event: EventRecord): void;
  clear(): void;
}

export const useEventsStore = create<EventsState>((set) => ({
  events: [],
  setEvents: (events) => set({ events: events.slice(-MAX_EVENTS) }),
  push: (event) =>
    set((s) => ({
      events: [...s.events, event].slice(-MAX_EVENTS),
    })),
  clear: () => set({ events: [] }),
}));
