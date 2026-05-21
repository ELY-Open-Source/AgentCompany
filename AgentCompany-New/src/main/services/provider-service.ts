import type { DatabaseSync } from "node:sqlite";
import type { SaveProviderCredentialInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { SecretVault } from "./secret-vault";

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
}
