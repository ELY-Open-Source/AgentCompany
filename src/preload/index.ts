import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/contracts/channels";
import type { DesktopApi } from "@shared/contracts/desktop-api";
import {
  PRELOAD_FORWARDERS,
  PRELOAD_INPUT_SCHEMAS,
  mapPreloadInvokeArgs,
  type PreloadForwardedApi,
} from "@shared/contracts/preload-forwarders";
import type { DesktopEvent } from "@shared/types";

function createForwardedApi(): PreloadForwardedApi {
  const forwardedEntries = PRELOAD_FORWARDERS.map(({ api, channel, payload }) => {
    const schema = PRELOAD_INPUT_SCHEMAS[api];
    return [
      api,
      (...args: unknown[]) => ipcRenderer.invoke(
        IPC_CHANNELS[channel],
        ...mapPreloadInvokeArgs(payload, args, schema),
      ),
    ];
  });

  return Object.fromEntries(forwardedEntries) as PreloadForwardedApi;
}

const api: DesktopApi = {
  ...createForwardedApi(),
  subscribe: (callback: (event: DesktopEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.rendererEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.rendererEvent, listener);
    };
  },
  platform: process.platform as "win32" | "darwin" | "linux",
  windowMinimize: async () => {
    await ipcRenderer.invoke(IPC_CHANNELS.windowMinimize);
  },
  windowMaximize: async () => {
    await ipcRenderer.invoke(IPC_CHANNELS.windowMaximize);
  },
  windowClose: async () => {
    await ipcRenderer.invoke(IPC_CHANNELS.windowClose);
  },
  windowIsMaximized: async () => {
    const result = (await ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized)) as { ok: true; data: boolean } | { ok: false };
    return result.ok ? result.data : false;
  },
};

contextBridge.exposeInMainWorld("agentCompany", api);
