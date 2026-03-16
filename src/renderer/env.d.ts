import type { DesktopApi } from "@shared/contracts";

declare global {
  interface Window {
    agentCompany: DesktopApi;
  }
}

export {};
