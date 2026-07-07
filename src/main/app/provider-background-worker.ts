import type { BrowserWindow } from "electron";
import type { DatabaseSync } from "node:sqlite";
import { IPC_CHANNELS } from "../../shared/ipc";
import { ProviderBackgroundService } from "../services/provider-background-service";

const DEFAULT_INTERVAL_MS = 8_000;

export interface ProviderBackgroundWorkerInput {
  db: DatabaseSync;
  mainWindow: BrowserWindow;
  intervalMs?: number;
}

export function startProviderBackgroundWorker(input: ProviderBackgroundWorkerInput): () => void {
  const service = new ProviderBackgroundService(input.db);
  let running = false;
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const changedCount = await service.recoverBackgroundResponses();
      if (changedCount > 0 && !input.mainWindow.isDestroyed()) {
        input.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "snapshot-changed" });
      }
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();

  return () => clearInterval(interval);
}
