import type { StateCreator } from "zustand";
import type { AppState } from "../store";

export interface CommunicationSlice {
  // Placeholder for future message state -- this slice will be populated
  // during component decomposition. The communication component currently
  // manages its own internal state.
}

export const createCommunicationSlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  CommunicationSlice
> = () => ({
  // Empty state for now
});
