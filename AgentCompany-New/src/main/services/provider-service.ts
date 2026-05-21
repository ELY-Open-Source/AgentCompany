import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { CreateProviderResponseInput, SaveProviderCredentialInput } from "../../shared/commands";
import { PROVIDER_AUTH_TYPE, PROVIDER_REQUEST_STATE } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { SecretVault } from "./secret-vault";
import { providerAdapters } from "./provider-adapters";

function displayHint(secret: string): string {
  const clean = secret.trim();
  if (clean.length <= 10) return `${clean.slice(0, 2)}...`;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

export class ProviderService {
  private readonly audit: AuditService;
  private readonly vault = new SecretVault();

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  saveCredential(input: SaveProviderCredentialInput): void {
    const provider = this.db.prepare("select * from providers where id = ? and org_id = ?")
      .get(input.providerId, input.orgId) as { provider_key: string; auth_type: string } | undefined;
    if (!provider) throw new Error("Provider was not found.");
    const secret = input.secret.trim();
    if (!secret) throw new Error("Credential is required.");
    const credentialId = createId("cred");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into credentials(id, org_id, provider_key, kind, ciphertext, display_hint, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(
      credentialId,
      input.orgId,
      provider.provider_key,
      provider.auth_type,
      this.vault.encryptSecret(secret),
      displayHint(secret),
      now,
    );
    this.db.prepare("update providers set credential_id = ?, model = ?, enabled = 1 where id = ? and org_id = ?")
      .run(credentialId, input.model, input.providerId, input.orgId);
    this.audit.record({
      orgId: input.orgId,
      entityType: "provider",
      entityId: input.providerId,
      actorType: "system",
      actorId: null,
      action: "credential_saved",
      payload: { providerKey: provider.provider_key, authType: provider.auth_type },
    });
  }

  async createResponse(input: CreateProviderResponseInput): Promise<void> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("Prompt is required.");
    const provider = this.db.prepare(`
      select id, provider_key, auth_type, model, credential_id, enabled
      from providers
      where id = ? and org_id = ?
    `).get(input.providerId, input.orgId) as ProviderRow | undefined;
    if (!provider) throw new Error("Provider was not found.");
    if (provider.enabled !== 1) throw new Error("Provider credential is required.");
    if (provider.auth_type !== PROVIDER_AUTH_TYPE.API_KEY) {
      throw new Error("Provider response execution requires an API key adapter.");
    }
    if (!provider.credential_id) throw new Error("Provider credential is required.");
    if (!provider.model) throw new Error("Provider model is required.");
    const adapter = providerAdapters[provider.provider_key];
    if (!adapter) throw new Error(`Provider adapter is unavailable for ${provider.provider_key}.`);

    const credential = this.db.prepare(`
      select ciphertext
      from credentials
      where id = ? and org_id = ? and provider_key = ?
    `).get(provider.credential_id, input.orgId, provider.provider_key) as { ciphertext: Uint8Array } | undefined;
    if (!credential) throw new Error("Provider credential was not found.");

    const requestId = createId("preq");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into provider_requests(
        id, org_id, provider_id, provider_key, model, prompt_sha256,
        response_text, raw_response_json, state, error_message, created_at, completed_at
      )
      values (?, ?, ?, ?, ?, ?, null, null, ?, null, ?, null)
    `).run(
      requestId,
      input.orgId,
      provider.id,
      provider.provider_key,
      provider.model,
      hashPrompt(prompt),
      PROVIDER_REQUEST_STATE.PENDING,
      now,
    );

    try {
      const apiKey = this.vault.decryptSecret(Buffer.from(credential.ciphertext));
      const result = await adapter.createResponse({
        apiKey,
        model: provider.model,
        prompt,
        instructions: input.instructions?.trim() || null,
      });
      this.db.prepare(`
        update provider_requests
        set state = ?, response_text = ?, raw_response_json = ?, completed_at = ?
        where id = ? and org_id = ?
      `).run(PROVIDER_REQUEST_STATE.SUCCEEDED, result.text, result.rawResponseJson, new Date().toISOString(), requestId, input.orgId);
      this.audit.record({
        orgId: input.orgId,
        entityType: "provider_request",
        entityId: requestId,
        actorType: "system",
        actorId: null,
        action: "response_created",
        payload: { providerKey: provider.provider_key, model: provider.model },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.prepare(`
        update provider_requests
        set state = ?, error_message = ?, completed_at = ?
        where id = ? and org_id = ?
      `).run(PROVIDER_REQUEST_STATE.FAILED, message, new Date().toISOString(), requestId, input.orgId);
      throw error;
    }
  }
}

interface ProviderRow {
  id: string;
  provider_key: string;
  auth_type: string;
  model: string | null;
  credential_id: string | null;
  enabled: number;
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}
