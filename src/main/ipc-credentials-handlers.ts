import { ipcMain } from "electron";
import { streamSimple, type SimpleStreamOptions } from "@mariozechner/pi-ai";
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

interface DesktopOk<T> { ok: true; data: T }
interface DesktopErr { ok: false; error: { code: string; message: string } }
type DesktopResult<T> = DesktopOk<T> | DesktopErr;

function ok<T>(data: T): DesktopOk<T> { return { ok: true, data }; }
function err(code: string, message: string): DesktopErr { return { ok: false, error: { code, message } }; }

/** Strip credential-shaped substrings from an error message before sending it
 * back to the renderer. Catches the obvious patterns: Bearer tokens, OpenAI
 * `sk-` and Anthropic `sk-ant-` keys, AWS access key IDs, JWTs, and any ≥32-char
 * hex/base64 blob. */
function redactSecrets(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9\-_.~+/=]+/gi, "Bearer [REDACTED]")
    .replace(/sk-(ant|proj)-[A-Za-z0-9\-_]+/g, "sk-$1-[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{20,}/g, "sk-[REDACTED]")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA[REDACTED]")
    .replace(/eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, "[REDACTED-JWT]")
    .replace(/[A-Fa-f0-9]{40,}/g, "[REDACTED-HEX]")
    .replace(/[A-Za-z0-9+/]{48,}={0,2}/g, "[REDACTED-B64]");
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
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

/** Serializes `credentialsTest` calls that must mutate `process.env` to inject
 * per-provider configuration for pi-ai (Azure / AWS / GCP ADC). pi-ai's
 * `SimpleStreamOptions` has no per-request env escape hatch — its providers
 * read `process.env` directly — so two concurrent tests would clobber each
 * other's env and surface cross-credential failures. A module-level promise
 * chain guarantees at most one `extraEnv`-mutating test runs at a time. */
let credentialTestChain: Promise<void> = Promise.resolve();

function serializeCredentialTest<T>(task: () => Promise<T>): Promise<T> {
  const run = credentialTestChain.then(task, task);
  credentialTestChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function registerCredentialIpcHandlers(deps: CredentialHandlerDeps): () => void {
  const handlers: Array<[string, (...args: unknown[]) => unknown]> = [];

  function handle<T>(channel: string, handler: (input: unknown) => Promise<DesktopResult<T>>) {
    const wrapped = async (_event: unknown, input: unknown) => handler(input);
    ipcMain.handle(channel, wrapped);
    handlers.push([channel, wrapped as never]);
  }

  handle<CredentialSummary[]>(IPC_CHANNELS.credentialsList, async () => {
    return ok(deps.store.list());
  });

  handle<CredentialSummary>(IPC_CHANNELS.credentialsSave, async (raw) => {
    const parsed = saveCredentialInputSchema.safeParse(raw);
    if (!parsed.success) return err("INVALID_INPUT", parsed.error.message);
    const definition = (() => {
      try { return getConnectorDefinition(parsed.data.connectorId); }
      catch (e) { return e instanceof Error ? e.message : String(e); }
    })();
    if (typeof definition === "string") return err("UNKNOWN_CONNECTOR", definition);

    const payload = parsed.data.payload;
    if (definition.auth.type === "oauth") {
      return err("UNSUPPORTED_PAYLOAD", "Use OAuth login flow for OAuth connectors.");
    }
    if (definition.auth.type !== payload.kind) {
      return err("MISMATCHED_KIND", `Connector ${parsed.data.connectorId} expects ${definition.auth.type} credential.`);
    }
    try {
      const stored = deps.store.save(parsed.data.connectorId, payload as StoredCredentialPayload, null);
      await deps.refreshConnectorHealth(parsed.data.connectorId);
      deps.emitEvent({ type: "credentials-changed", connectorId: parsed.data.connectorId });
      return ok(stored);
    } catch (error) {
      deps.logger.error(`[credentials] save failed for ${parsed.data.connectorId}: ${describeError(error)}`);
      return err("SAVE_FAILED", "Could not save credential. Check application logs for details.");
    }
  });

  handle<boolean>(IPC_CHANNELS.credentialsRemove, async (raw) => {
    const parsed = removeCredentialInputSchema.safeParse(raw);
    if (!parsed.success) return err("INVALID_INPUT", parsed.error.message);
    try {
      deps.store.remove(parsed.data.connectorId);
      await deps.refreshConnectorHealth(parsed.data.connectorId);
      deps.emitEvent({ type: "credentials-changed", connectorId: parsed.data.connectorId });
      return ok(true);
    } catch (error) {
      deps.logger.error(`[credentials] remove failed for ${parsed.data.connectorId}: ${describeError(error)}`);
      return err("REMOVE_FAILED", "Could not remove credential. Check application logs for details.");
    }
  });

  handle<{ ok: boolean; message: string }>(IPC_CHANNELS.credentialsTest, async (raw) => {
    const parsed = testCredentialInputSchema.safeParse(raw);
    if (!parsed.success) return err("INVALID_INPUT", parsed.error.message);
    let definition;
    try {
      definition = getConnectorDefinition(parsed.data.connectorId);
    } catch (error) {
      deps.logger.error(`[credentials] test failed lookup for ${parsed.data.connectorId}: ${describeError(error)}`);
      return err("UNKNOWN_CONNECTOR", "Unknown connector.");
    }
    let resolved;
    try {
      resolved = await deps.resolver.resolve(parsed.data.connectorId);
    } catch (error) {
      const message = describeError(error);
      deps.logger.error(`[credentials] test resolve failed for ${parsed.data.connectorId}: ${message}`);
      return ok({ ok: false, message: redactSecrets(message) });
    }

    const runTest = async (): Promise<DesktopResult<{ ok: boolean; message: string }>> => {
      try {
        const model = resolveModel(definition.provider, definition.defaultModel);
        if (!model) return ok({ ok: false, message: `Unknown model ${definition.defaultModel} for provider ${definition.provider}` });
        const extraHeaders = resolveExtraStreamHeaders(definition.provider, resolved.apiKey);
        const options: SimpleStreamOptions = {
          apiKey: resolved.apiKey,
          maxTokens: 1,
          ...(extraHeaders ? { headers: extraHeaders } : {}),
        };
        const stream = streamSimple(
          model,
          {
            systemPrompt: "Reply with the single character 'k'.",
            messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
          },
          options,
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

    // Providers that require per-request env (Azure/AWS/GCP ADC) must mutate
    // `process.env` because pi-ai reads it directly. Serialize those tests so
    // concurrent invocations cannot observe each other's env.
    if (resolved.extraEnv) {
      const envPatch = resolved.extraEnv;
      return serializeCredentialTest(async () => {
        const saved = new Map<string, string | undefined>();
        for (const [k, v] of Object.entries(envPatch)) {
          saved.set(k, process.env[k]);
          process.env[k] = v;
        }
        try {
          return await runTest();
        } finally {
          for (const [k, prev] of saved) {
            if (prev === undefined) delete process.env[k];
            else process.env[k] = prev;
          }
        }
      });
    }

    return runTest();
  });

  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel);
  };
}
