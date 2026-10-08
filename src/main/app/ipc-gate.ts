import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { IPC_CHANNELS } from "../../shared/ipc";
import { fail } from "../../shared/result";
import { IPC_CONTRACTS, type InputOf, type InvokedMethod } from "./ipc-contracts";
import { isAppPage } from "./window-security";

/** Why a call is refused, or null: only the app's own window, from its top frame, on the app's own page may call. */
export function senderRefusal(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, mainWindow: BrowserWindow, appPage: string): string | null {
  if (event.sender.id !== mainWindow.webContents.id) return "the call did not come from the app window";
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return "the call did not come from the app window's top frame";
  return isAppPage(frame.url, appPage) ? null : `the calling page ${frame.url} is not the app's own`;
}

/** Registers an IPC call behind one gate: the caller is checked, then the input against the call's contract, before any service sees it. */
export function createIpcGate(mainWindow: BrowserWindow, appPage: string) {
  return <K extends InvokedMethod>(name: K, run: (input: InputOf<K>) => unknown): void => {
    ipcMain.handle(IPC_CHANNELS[name], (event, raw: unknown) => {
      const refusal = senderRefusal(event, mainWindow, appPage);
      if (refusal) {
        console.warn(`[ipc] refused ${name}: ${refusal}`);
        return fail("forbidden_sender", refusal);
      }
      const contract: z.ZodType<InputOf<K>> = IPC_CONTRACTS[name];
      const parsed = contract.safeParse(raw);
      if (!parsed.success) {
        const detail = z.prettifyError(parsed.error);
        console.warn(`[ipc] invalid ${name} input: ${detail}`);
        return fail("invalid_input", `${name}: ${detail}`);
      }
      return run(parsed.data);
    });
  };
}
