import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { ProviderAuthType } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { SecretVault } from "./secret-vault";

export interface ProviderSecretVault {
  encryptSecret(secret: string): Buffer;
  decryptSecret(ciphertext: Buffer): string;
}

export interface CreateProviderAuthProfileInput {
  orgId: string;
  providerId: string;
  providerKey: string;
  authType: ProviderAuthType;
  secret: string;
  profileKind: string;
  sourceType: string;
  sourceRef: string | null;
  capabilityTags: string[];
}

export interface ProviderAuthProfileRef {
  authProfileId: string;
  credentialId: string;
  displayHint: string;
}

export interface RevokeProviderAuthProfileInput {
  orgId: string;
  providerId: string;
  providerKey: string;
}

export class AuthBrokerService {
  private readonly audit: AuditService;

  constructor(
    private readonly db: DatabaseSync,
    private readonly vault: ProviderSecretVault = new SecretVault(),
  ) {
    this.audit = new AuditService(db);
  }

  createProviderProfile(input: CreateProviderAuthProfileInput): ProviderAuthProfileRef {
    const secret = input.secret.trim();
    if (!secret) throw new Error("Credential is required.");
    const credentialId = createId("cred");
    const authProfileId = createId("authp");
    const displayHint = credentialDisplayHint(secret);
    const now = new Date().toISOString();
    const capabilityJson = JSON.stringify({
      providerKey: input.providerKey,
      authType: input.authType,
      capabilityTags: input.capabilityTags,
    });

    this.db.prepare(`
      insert into credentials(id, org_id, provider_key, kind, ciphertext, display_hint, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(credentialId, input.orgId, input.providerKey, input.authType, this.vault.encryptSecret(secret), displayHint, now);
    this.db.prepare(`
      update provider_auth_profiles
      set active = 0
      where org_id = ? and provider_id = ? and active = 1
    `).run(input.orgId, input.providerId);
    this.db.prepare(`
      insert into provider_auth_profiles(
        id, org_id, provider_id, credential_id, provider_key, auth_type,
        profile_kind, display_hint, source_type, source_ref, capability_json,
        active, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      authProfileId,
      input.orgId,
      input.providerId,
      credentialId,
      input.providerKey,
      input.authType,
      input.profileKind,
      displayHint,
      input.sourceType,
      input.sourceRef,
      capabilityJson,
      now,
    );
    this.audit.record({
      orgId: input.orgId,
      entityType: "provider_auth_profile",
      entityId: authProfileId,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: {
        providerId: input.providerId,
        providerKey: input.providerKey,
        authType: input.authType,
        profileKind: input.profileKind,
      },
    });
    return { authProfileId, credentialId, displayHint };
  }

  loadProviderSecret(input: {
    orgId: string;
    providerId: string;
    providerKey: string;
    credentialId: string;
  }): string {
    const row = this.db.prepare(`
      select credentials.ciphertext
      from provider_auth_profiles
      join credentials on credentials.id = provider_auth_profiles.credential_id
      where provider_auth_profiles.org_id = ?
        and provider_auth_profiles.provider_id = ?
        and provider_auth_profiles.provider_key = ?
        and provider_auth_profiles.credential_id = ?
        and provider_auth_profiles.active = 1
        and credentials.org_id = provider_auth_profiles.org_id
        and credentials.provider_key = provider_auth_profiles.provider_key
    `).get(input.orgId, input.providerId, input.providerKey, input.credentialId) as { ciphertext: Uint8Array } | undefined;
    if (!row) throw new Error("Provider credential was not found.");
    return this.vault.decryptSecret(Buffer.from(row.ciphertext));
  }

  /**
   * Re-encrypts a refreshed OAuth credential into its existing credential row,
   * keeping the same credential id (and active auth profile) so request-time
   * token refresh persists without re-binding the provider.
   */
  updateProviderSecret(input: { orgId: string; providerKey: string; credentialId: string; secret: string }): void {
    const secret = input.secret.trim();
    if (!secret) throw new Error("Credential is required.");
    const displayHint = credentialDisplayHint(secret);
    const result = this.db.prepare(`
      update credentials
      set ciphertext = ?, display_hint = ?
      where id = ? and org_id = ? and provider_key = ?
    `).run(this.vault.encryptSecret(secret), displayHint, input.credentialId, input.orgId, input.providerKey);
    if (result.changes === 0) throw new Error("Provider credential was not found.");
    this.db.prepare("update provider_auth_profiles set display_hint = ? where credential_id = ? and org_id = ?")
      .run(displayHint, input.credentialId, input.orgId);
  }

  revokeProviderProfile(input: RevokeProviderAuthProfileInput): void {
    const row = this.db.prepare(`
      select id, credential_id
      from provider_auth_profiles
      where org_id = ?
        and provider_id = ?
        and provider_key = ?
        and active = 1
    `).get(input.orgId, input.providerId, input.providerKey) as { id: string; credential_id: string } | undefined;
    if (!row) throw new Error("Provider credential was not found.");
    this.db.prepare("update provider_auth_profiles set active = 0 where id = ? and org_id = ?")
      .run(row.id, input.orgId);
    this.audit.record({
      orgId: input.orgId,
      entityType: "provider_auth_profile",
      entityId: row.id,
      actorType: "system",
      actorId: null,
      action: "revoked",
      payload: {
        providerId: input.providerId,
        providerKey: input.providerKey,
        credentialId: row.credential_id,
      },
    });
  }
}

function credentialDisplayHint(secret: string): string {
  const clean = secret.trim();
  if (clean.startsWith("{")) return `json:${createHash("sha256").update(clean).digest("hex").slice(0, 10)}`;
  if (clean.length <= 10) return `${clean.slice(0, 2)}...`;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}
