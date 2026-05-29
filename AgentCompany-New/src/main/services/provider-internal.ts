import type { DatabaseSync } from "node:sqlite";
import type { ProviderAuthType } from "../../shared/domain";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog";
import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
import type { AuthBrokerService } from "./auth-broker-service";
import type { ProviderAdapterRegistry } from "./provider-adapters";
import type { ProviderRateLimitRegistry } from "./provider-rate-limit-registry";

export const AUTH_STATE_CONFIGURED = "configured";
export const AUTH_STATE_REVOKED = "revoked";
export const HEALTH_STATE_HEALTHY = "healthy";
export const HEALTH_STATE_FAILED = "failed";
export const HEALTH_STATE_UNCHECKED = "unchecked";
export const WORKSPACE_SCOPES = new Set(["organization", "workspace"]);

export interface ProviderRow {
  id: string;
  provider_key: string;
  auth_type: ProviderAuthType;
  model: string | null;
  credential_id: string | null;
  enabled: number;
  auth_state: string;
  data_policy: string;
  background_enabled: number;
  monthly_request_limit: number;
  workspace_scope: string;
}

export function loadConfiguredProvider(db: DatabaseSync, orgId: string, providerId: string): ProviderRow {
  const provider = db.prepare(`
    select id, provider_key, auth_type, model, credential_id, enabled, auth_state,
      data_policy, background_enabled, monthly_request_limit, workspace_scope
    from providers
    where id = ? and org_id = ?
  `).get(providerId, orgId) as ProviderRow | undefined;
  if (!provider) throw new Error("Provider was not found.");
  if (provider.enabled !== 1 || provider.auth_state !== AUTH_STATE_CONFIGURED) throw new Error("Provider credential is required.");
  if (!provider.credential_id) throw new Error("Provider credential is required.");
  return provider;
}

export function loadCredential(authBroker: AuthBrokerService, orgId: string, provider: ProviderRow): { secret: string } {
  if (!provider.credential_id) throw new Error("Provider credential is required.");
  return {
    secret: authBroker.loadProviderSecret({
      orgId,
      providerId: provider.id,
      providerKey: provider.provider_key,
      credentialId: provider.credential_id,
    }),
  };
}

export function requireAdapter(
  adapters: ProviderAdapterRegistry,
  providerKey: string,
  authType: string,
): ProviderAdapterRegistry[string] {
  const adapter = adapters[providerKey];
  if (!adapter) throw new Error(`Provider adapter is unavailable for ${providerKey}.`);
  if (adapter.authType !== authType) throw new Error(`Provider adapter auth type mismatch for ${providerKey}.`);
  return adapter;
}

export function requireCatalogEntry(providerKey: string): (typeof PROVIDER_CATALOG)[number] {
  const entry = PROVIDER_CATALOG.find((item) => item.key === providerKey);
  if (!entry) throw new Error(`Provider catalog entry missing for ${providerKey}.`);
  return entry;
}

export function recordProviderHealth(
  db: DatabaseSync,
  providerId: string,
  orgId: string,
  healthState: string,
  error: string | null,
): void {
  db.prepare(`
    update providers
    set health_state = ?, last_error = ?, last_checked_at = ?
    where id = ? and org_id = ?
  `).run(healthState, error, new Date().toISOString(), providerId, orgId);
}

export function recordObservedRateLimit(
  rateLimitRegistry: ProviderRateLimitRegistry,
  orgId: string,
  provider: Pick<ProviderRow, "id" | "provider_key">,
  model: string | null,
  state: ProviderObservedRateLimitState | null,
): void {
  if (!state) return;
  rateLimitRegistry.recordObservation({
    orgId,
    providerId: provider.id,
    providerKey: provider.provider_key,
    model,
    state,
  });
}
