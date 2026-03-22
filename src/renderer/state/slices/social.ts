import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type { SocialAccountRecord, BrowserActionRecord } from "@shared/types";

export interface SocialSlice {
  socialAccounts: SocialAccountRecord[];
  browserActions: BrowserActionRecord[];
  setSocialAccounts: (accounts: SocialAccountRecord[]) => void;
  setBrowserActions: (actions: BrowserActionRecord[]) => void;
}

export const createSocialSlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  SocialSlice
> = (set) => ({
  socialAccounts: [],
  browserActions: [],
  setSocialAccounts: (accounts) =>
    set((state) => {
      state.socialAccounts = accounts;
    }),
  setBrowserActions: (actions) =>
    set((state) => {
      state.browserActions = actions;
    }),
});
