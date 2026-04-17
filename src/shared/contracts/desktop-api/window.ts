import type { DesktopEvent } from "../../types";

export type WindowApi = {
  subscribe: (callback: (event: DesktopEvent) => void) => () => void;
  platform: "win32" | "darwin" | "linux";
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
};
