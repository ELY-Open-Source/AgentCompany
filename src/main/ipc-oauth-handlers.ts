import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { DesktopResult } from "@shared/contracts";
import { IPC_CHANNELS } from "@shared/contracts";
import {
  oauthCancelInputSchema,
  oauthManualCodeResponseSchema,
  oauthPromptResponseSchema,
  oauthStartInputSchema,
} from "@shared/contracts/schemas-oauth";
import type { OAuthLoginService } from "./credentials/oauth-login-service";
import { ok } from "./ipc-core-common";

interface OAuthHandlerDeps {
  service: OAuthLoginService;
  registerHandle: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>,
  ) => void;
  fail: (code: string, message: string) => DesktopResult<never>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export function registerOAuthIpcHandlers(deps: OAuthHandlerDeps): () => void {
  const channels: string[] = [
    IPC_CHANNELS.oauthStart,
    IPC_CHANNELS.oauthCancel,
    IPC_CHANNELS.oauthPromptResponse,
    IPC_CHANNELS.oauthManualCodeResponse,
  ];

  deps.registerHandle(IPC_CHANNELS.oauthStart, async (_event, raw) => {
    const parsed = oauthStartInputSchema.safeParse(raw);
    if (!parsed.success) return deps.fail("INVALID_INPUT", parsed.error.message);
    deps.service.start(parsed.data.connectorId).catch((error) => {
      deps.logger.warn(`[oauth] login flow ended: ${error instanceof Error ? error.message : String(error)}`);
    });
    return ok(true);
  });

  deps.registerHandle(IPC_CHANNELS.oauthCancel, async (_event, raw) => {
    const parsed = oauthCancelInputSchema.safeParse(raw);
    if (!parsed.success) return deps.fail("INVALID_INPUT", parsed.error.message);
    deps.service.cancel(parsed.data.connectorId);
    return ok(true);
  });

  deps.registerHandle(IPC_CHANNELS.oauthPromptResponse, async (_event, raw) => {
    const parsed = oauthPromptResponseSchema.safeParse(raw);
    if (!parsed.success) return deps.fail("INVALID_INPUT", parsed.error.message);
    const accepted = deps.service.submitPromptResponse(parsed.data.requestId, parsed.data.value);
    return ok(accepted);
  });

  deps.registerHandle(IPC_CHANNELS.oauthManualCodeResponse, async (_event, raw) => {
    const parsed = oauthManualCodeResponseSchema.safeParse(raw);
    if (!parsed.success) return deps.fail("INVALID_INPUT", parsed.error.message);
    const accepted = deps.service.submitManualCode(parsed.data.requestId, parsed.data.code);
    return ok(accepted);
  });

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
