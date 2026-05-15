import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { SimpleStreamOptions } from "@mariozechner/pi-ai";
import type { DesktopResult } from "@shared/contracts";
import { IPC_CHANNELS } from "@shared/contracts";
import {
  removeCredentialInputSchema,
  saveCredentialInputSchema,
  testCredentialInputSchema,
  type CredentialSummary,
} from "@shared/contracts/schemas-credentials";
import type { DesktopEvent } from "@shared/types";
import { getConnectorDefinition } from "./connectors";
import { resolveModel, resolveExtraStreamHeaders } from "./model-resolver";
import type { CredentialResolver } from "./credentials/credential-resolver";
import type { CredentialStore } from "./credentials/credential-store";
import type { StoredCredentialPayload } from "./credentials/types";
import { ok } from "./ipc-core-common";
import { classifyUnknownError } from "./errors/index.js";
import { safeStreamSimpleWithEnv } from "./worker/runtime/pi-safe-stream";

/** Strip credential-shaped substrings from an error message before sending it
 * back to the renderer. Matches are anchored to issuer-specific prefixes so
 * we do not shred diagnostic signals — git SHAs, UUIDs, model identifiers
 * like `accounts/fireworks/models/...`, and other high-entropy-but-not-secret
 * strings pass through unchanged. */
function redactSecrets(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9\-_.~+/=]+/gi, "Bearer [REDACTED]")
    .replace(/sk-(ant|proj)-[A-Za-z0-9\-_]+/g, "sk-$1-[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{20,}/g, "sk-[REDACTED]")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED-JWT]");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface CredentialHandlerDeps {
  store: CredentialStore;
  resolver: CredentialResolver;
  emitEvent: (event: DesktopEvent) => void;
  /** Refresh the connector's health row after a save/remove so its `status`
   * flips between `auth_required` and `ready` immediately, instead of waiting
   * for the next bootstrap pass. */
  refreshConnectorHealth: (connectorId: string) => Promise<void>;
  registerHandle: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>,
  ) => void;
  fail: (code: string, message: string) => DesktopResult<never>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export function registerCredentialIpcHandlers(deps: CredentialHandlerDeps): () => void {
  const channels: string[] = [
    IPC_CHANNELS.credentialsList,
    IPC_CHANNELS.credentialsSave,
    IPC_CHANNELS.credentialsRemove,
    IPC_CHANNELS.credentialsTest,
  ];

  deps.registerHandle(IPC_CHANNELS.credentialsList, async () => {
    return ok(deps.store.list());
  });

  deps.registerHandle(IPC_CHANNELS.credentialsSave, async (_event, raw) => {
    const parsed = saveCredentialInputSchema.safeParse(raw);
    if (!parsed.success) return deps.fail("INVALID_INPUT", parsed.error.message);
    const definition = (() => {
      try { return getConnectorDefinition(parsed.data.connectorId); }
      catch (e) { return e instanceof Error ? e.message : String(e); }
    })();
    if (typeof definition === "string") return deps.fail("UNKNOWN_CONNECTOR", definition);

    const payload = parsed.data.payload;
    if (!definition.auth) {
      return deps.fail("UNSUPPORTED_PAYLOAD", `Connector ${parsed.data.connectorId} has no auth schema.`);
    }
    if (definition.auth.type === "oauth") {
      return deps.fail("UNSUPPORTED_PAYLOAD", "Use OAuth login flow for OAuth connectors.");
    }
    if (definition.auth.type !== payload.kind) {
      return deps.fail("MISMATCHED_KIND", `Connector ${parsed.data.connectorId} expects ${definition.auth.type} credential.`);
    }
    try {
      const stored = deps.store.save(parsed.data.connectorId, payload as StoredCredentialPayload, null);
      await deps.refreshConnectorHealth(parsed.data.connectorId);
      deps.emitEvent({ type: "credentials-changed", connectorId: parsed.data.connectorId });
      return ok<CredentialSummary>(stored);
    } catch (error) {
      const err = classifyUnknownError(error, {
        kind: "upstream",
        code: "credentials.save.failed",
        message: `save failed for ${parsed.data.connectorId}`,
        context: { connectorId: parsed.data.connectorId },
      });
      deps.logger.error(`[${err.code}] ${err.message}: ${describeError(error)}`);
      return deps.fail("SAVE_FAILED", "Could not save credential. Check application logs for details.");
    }
  });

  deps.registerHandle(IPC_CHANNELS.credentialsRemove, async (_event, raw) => {
    const parsed = removeCredentialInputSchema.safeParse(raw);
    if (!parsed.success) return deps.fail("INVALID_INPUT", parsed.error.message);
    try {
      deps.store.remove(parsed.data.connectorId);
      await deps.refreshConnectorHealth(parsed.data.connectorId);
      deps.emitEvent({ type: "credentials-changed", connectorId: parsed.data.connectorId });
      return ok(true);
    } catch (error) {
      const err = classifyUnknownError(error, {
        kind: "upstream",
        code: "credentials.remove.failed",
        message: `remove failed for ${parsed.data.connectorId}`,
        context: { connectorId: parsed.data.connectorId },
      });
      deps.logger.error(`[${err.code}] ${err.message}: ${describeError(error)}`);
      return deps.fail("REMOVE_FAILED", "Could not remove credential. Check application logs for details.");
    }
  });

  deps.registerHandle(IPC_CHANNELS.credentialsTest, async (_event, raw) => {
    const parsed = testCredentialInputSchema.safeParse(raw);
    if (!parsed.success) return deps.fail("INVALID_INPUT", parsed.error.message);
    let definition;
    try {
      definition = getConnectorDefinition(parsed.data.connectorId);
    } catch (error) {
      const err = classifyUnknownError(error, {
        kind: "user_input",
        code: "credentials.test.unknown_connector",
        message: `test failed lookup for ${parsed.data.connectorId}`,
        context: { connectorId: parsed.data.connectorId },
      });
      deps.logger.error(`[${err.code}] ${err.message}: ${describeError(error)}`);
      return deps.fail("UNKNOWN_CONNECTOR", "Unknown connector.");
    }
    let resolved;
    try {
      resolved = await deps.resolver.resolve(parsed.data.connectorId);
    } catch (error) {
      const err = classifyUnknownError(error, {
        kind: "upstream",
        code: "credentials.test.resolve_failed",
        message: `test resolve failed for ${parsed.data.connectorId}`,
        context: { connectorId: parsed.data.connectorId },
      });
      const message = describeError(error);
      deps.logger.error(`[${err.code}] ${err.message}: ${message}`);
      return ok({ ok: false, message: redactSecrets(message) });
    }

    const runTest = async (): Promise<DesktopResult<{ ok: boolean; message: string }>> => {
      try {
        if (!definition.provider) {
          return ok({ ok: false, message: `Connector ${parsed.data.connectorId} has no pi-ai provider id configured.` });
        }
        if (!definition.defaultModel) {
          return ok({ ok: false, message: `Connector ${parsed.data.connectorId} has no default model configured.` });
        }
        const provider = definition.provider;
        const defaultModel = definition.defaultModel;
        const model = resolveModel(provider, defaultModel, { baseUrl: resolved.baseUrl });
        if (!model) return ok({ ok: false, message: `Unknown model ${defaultModel} for provider ${provider}` });
        const extraHeaders = resolveExtraStreamHeaders(provider, resolved.apiKey);
        const options: SimpleStreamOptions = {
          apiKey: resolved.apiKey,
          maxTokens: 1,
          ...(extraHeaders ? { headers: extraHeaders } : {}),
        };
        const stream = safeStreamSimpleWithEnv(
          model,
          {
            systemPrompt: "Reply with the single character 'k'.",
            messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
          },
          options,
          resolved.extraEnv,
        );
        const final = await stream.result();
        if (final.stopReason === "error" || final.stopReason === "aborted") {
          const message = final.errorMessage ?? `Provider returned ${final.stopReason}.`;
          deps.logger.warn(`[credentials] test failed for ${parsed.data.connectorId}: ${message}`);
          return ok({ ok: false, message: redactSecrets(message) });
        }
        return ok({ ok: true, message: `OK (${model.id})` });
      } catch (error) {
        const message = describeError(error);
        deps.logger.error(`[credentials] test threw for ${parsed.data.connectorId}: ${message}`);
        return ok({ ok: false, message: redactSecrets(message) });
      }
    };

    return runTest();
  });

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
