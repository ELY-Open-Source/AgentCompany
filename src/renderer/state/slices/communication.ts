import type { StateCreator } from "zustand";
import type { AgentMessageRecord } from "@shared/types";
import type { AppState } from "../store";

export interface CommunicationSlice {
  searchQuery: string;
  searchScope: "global" | "channel";
  searchResults: AgentMessageRecord[];
  searchLoading: boolean;
  searchRequestId: number;
  setSearchQuery: (query: string) => void;
  setSearchScope: (scope: "global" | "channel") => void;
  setSearchResults: (results: AgentMessageRecord[], requestId: number) => void;
  setSearchLoading: (loading: boolean) => void;
  clearSearch: () => void;
}

export const createCommunicationSlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  CommunicationSlice
> = (set) => ({
  searchQuery: "",
  searchScope: "global",
  searchResults: [],
  searchLoading: false,
  searchRequestId: 0,
  setSearchQuery: (query) =>
    set((state) => {
      state.searchQuery = query;
      state.searchRequestId += 1;
    }),
  setSearchScope: (scope) =>
    set((state) => {
      state.searchScope = scope;
    }),
  setSearchResults: (results, requestId) =>
    set((state) => {
      if (requestId === state.searchRequestId) {
        state.searchResults = results;
        state.searchLoading = false;
      }
    }),
  setSearchLoading: (loading) =>
    set((state) => {
      state.searchLoading = loading;
    }),
  clearSearch: () =>
    set((state) => {
      state.searchQuery = "";
      state.searchResults = [];
      state.searchLoading = false;
    }),
});
