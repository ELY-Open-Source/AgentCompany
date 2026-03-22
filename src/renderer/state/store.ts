import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { devtools } from "zustand/middleware";
import {
  createNavigationSlice,
  type NavigationSlice,
} from "./slices/navigation";
import { createCompanySlice, type CompanySlice } from "./slices/company";
import {
  createSelectionSlice,
  type SelectionSlice,
} from "./slices/selection";
import { createUiSlice, type UiSlice } from "./slices/ui";
import {
  createCommunicationSlice,
  type CommunicationSlice,
} from "./slices/communication";
import { createSocialSlice, type SocialSlice } from "./slices/social";

export type AppState = NavigationSlice &
  CompanySlice &
  SelectionSlice &
  UiSlice &
  CommunicationSlice &
  SocialSlice;

export const useAppStore = create<AppState>()(
  devtools(
    immer((...a) => ({
      ...createNavigationSlice(...a),
      ...createCompanySlice(...a),
      ...createSelectionSlice(...a),
      ...createUiSlice(...a),
      ...createCommunicationSlice(...a),
      ...createSocialSlice(...a),
    })),
    {
      name: "AgentCompany",
      enabled: process.env.NODE_ENV === "development",
    }
  )
);
