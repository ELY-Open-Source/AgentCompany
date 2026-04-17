import { randomUUID } from "node:crypto";
import { shell } from "electron";
import { getOAuthProvider, type OAuthLoginCallbacks } from "@mariozechner/pi-ai/oauth";
import type { DesktopEvent } from "@shared/types";
import { getConnectorDefinition } from "@main/connectors";
import { CredentialStore } from "./credential-store";
import type { OAuthCredentialPayload } from "./types";

interface PendingPrompt {
  connectorId: string;
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}

export interface OAuthLoginServiceDeps {
  store: CredentialStore;
  emitEvent: (event: DesktopEvent) => void;
  /** Refresh the connector's health row after a successful login so its
   * `status` flips from `auth_required` to `ready` without waiting for the
   * next bootstrap pass. */
  refreshConnectorHealth: (connectorId: string) => Promise<void>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export class OAuthLoginService {
  private readonly active = new Map<string, AbortController>();
  private readonly prompts = new Map<string, PendingPrompt>();
  private readonly manualCodes = new Map<string, PendingPrompt>();

  constructor(private readonly deps: OAuthLoginServiceDeps) {}

  async start(connectorId: string): Promise<void> {
    const definition = getConnectorDefinition(connectorId);
    if (definition.auth.type !== "oauth") {
      throw new Error(`Connector ${connectorId} does not use OAuth.`);
    }
    const provider = getOAuthProvider(definition.auth.oauthId);
    if (!provider) {
      throw new Error(`Unknown OAuth provider: ${definition.auth.oauthId}`);
    }

    if (this.active.has(connectorId)) {
      throw new Error(`OAuth login already in progress for ${connectorId}.`);
    }
    const controller = new AbortController();
    this.active.set(connectorId, controller);
    this.deps.emitEvent({ type: "oauth:status", connectorId, status: "in_progress" });

    let lastAuthUrl: string | undefined;
    let lastAuthInstructions: string | undefined;

    const callbacks: OAuthLoginCallbacks = {
      onAuth: ({ url, instructions }: { url: string; instructions?: string }) => {
        lastAuthUrl = url;
        lastAuthInstructions = instructions;
        void shell.openExternal(url);
        this.deps.emitEvent({
          type: "oauth:auth-url",
          connectorId,
          url,
          instructions,
        });
      },
      onProgress: (message: string) => {
        this.deps.emitEvent({ type: "oauth:progress", connectorId, message });
      },
      onPrompt: ({ message, placeholder, allowEmpty }: { message: string; placeholder?: string; allowEmpty?: boolean }) => {
        return new Promise<string>((resolve, reject) => {
          const requestId = randomUUID();
          this.prompts.set(requestId, { connectorId, resolve, reject });
          this.deps.emitEvent({
            type: "oauth:prompt-request",
            connectorId,
            requestId,
            message,
            placeholder,
            allowEmpty,
          });
        });
      },
      onManualCodeInput: () => {
        return new Promise<string>((resolve, reject) => {
          const requestId = randomUUID();
          this.manualCodes.set(requestId, { connectorId, resolve, reject });
          this.deps.emitEvent({
            type: "oauth:manual-code-request",
            connectorId,
            requestId,
            authUrl: lastAuthUrl,
            instructions: lastAuthInstructions,
          });
        });
      },
      signal: controller.signal,
    };

    try {
      const credentials = await provider.login(callbacks);
      const expiresAt = typeof credentials.expires === "number" && Number.isFinite(credentials.expires)
        ? new Date(credentials.expires).toISOString()
        : null;
      this.deps.store.save(
        connectorId,
        { kind: "oauth", value: credentials as OAuthCredentialPayload },
        expiresAt,
      );
      await this.deps.refreshConnectorHealth(connectorId);
      this.deps.emitEvent({ type: "oauth:status", connectorId, status: "active" });
      this.deps.emitEvent({ type: "credentials-changed", connectorId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = controller.signal.aborted ? "cancelled" : "error";
      this.deps.emitEvent({ type: "oauth:status", connectorId, status, errorMessage: status === "error" ? message : undefined });
      throw error;
    } finally {
      this.active.delete(connectorId);
      this.failPending(connectorId, "OAuth login session ended.");
    }
  }

  cancel(connectorId: string): void {
    const controller = this.active.get(connectorId);
    if (controller) {
      controller.abort();
    }
    this.failPending(connectorId, "Cancelled by user.");
  }

  submitPromptResponse(requestId: string, value: string): boolean {
    const pending = this.prompts.get(requestId);
    if (!pending) return false;
    this.prompts.delete(requestId);
    pending.resolve(value);
    return true;
  }

  submitManualCode(requestId: string, code: string): boolean {
    const pending = this.manualCodes.get(requestId);
    if (!pending) return false;
    this.manualCodes.delete(requestId);
    pending.resolve(code);
    return true;
  }

  private failPending(connectorId: string, reason: string) {
    for (const [id, pending] of this.prompts) {
      if (pending.connectorId !== connectorId) continue;
      pending.reject(new Error(reason));
      this.prompts.delete(id);
    }
    for (const [id, pending] of this.manualCodes) {
      if (pending.connectorId !== connectorId) continue;
      pending.reject(new Error(reason));
      this.manualCodes.delete(id);
    }
  }
}
