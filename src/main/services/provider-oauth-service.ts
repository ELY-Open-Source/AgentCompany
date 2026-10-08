import { getOAuthFlow } from "./oauth/oauth-flows";
import type { IntegrationKeyStore } from "./integration-key-store";

export interface ProviderOAuthHooks {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onProgress?: (message: string) => void;
}

/**
 * Drives a provider's native OAuth login and returns the obtained credentials
 * as a JSON string, ready to be stored through the existing secret vault. The
 * service is decoupled from Electron: opening the browser and emitting UI
 * events are supplied by the caller via {@link ProviderOAuthHooks}.
 */
export class ProviderOAuthService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly keys: IntegrationKeyStore) {}

  async run(input: { providerKey: string; enterpriseDomain?: string | null }, hooks: ProviderOAuthHooks): Promise<string> {
    const flow = getOAuthFlow(input.providerKey);
    if (this.controllers.has(input.providerKey)) {
      throw new Error("A sign-in for this provider is already in progress.");
    }
    const controller = new AbortController();
    this.controllers.set(input.providerKey, controller);
    try {
      const credentials = await flow.login({
        onAuth: hooks.onAuth,
        onProgress: hooks.onProgress,
        signal: controller.signal,
        enterpriseDomain: input.enterpriseDomain ?? null,
        clientSecret: input.providerKey === "google-antigravity" ? this.keys.read("google_antigravity_client_secret") : null,
      });
      return JSON.stringify(credentials);
    } finally {
      this.controllers.delete(input.providerKey);
    }
  }

  cancel(providerKey: string): void {
    this.controllers.get(providerKey)?.abort();
  }
}
