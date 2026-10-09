import type { DatabaseSync } from "node:sqlite";
import type { ProviderEndpoint } from "../../shared/commands";
import type { AuthBrokerService } from "./auth-broker-service";
import { loadCredential, type ProviderRow } from "./provider-internal";

function savedPayload(db: DatabaseSync, authBroker: AuthBrokerService, orgId: string, providerId: string): Record<string, unknown> | null {
  const provider = db.prepare("select * from providers where id = ? and org_id = ?").get(providerId, orgId) as ProviderRow | undefined;
  if (!provider) throw new Error("Provider was not found.");
  if (provider.auth_type !== "cloud" || !provider.credential_id) return null;
  return JSON.parse(loadCredential(authBroker, orgId, provider).secret) as Record<string, unknown>;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The saved address, region, project and deployment of a cloud or custom provider, so its form shows what is in use; never the key. */
export function providerEndpoint(db: DatabaseSync, authBroker: AuthBrokerService, orgId: string, providerId: string): ProviderEndpoint | null {
  const saved = savedPayload(db, authBroker, orgId, providerId);
  return saved ? { baseUrl: text(saved.baseUrl), region: text(saved.region), projectId: text(saved.projectId), deployment: text(saved.deployment) } : null;
}

/** A cloud form that left its key blank asks to keep the saved key; the saved key goes into the new payload. */
export function withSavedSecret(db: DatabaseSync, authBroker: AuthBrokerService, orgId: string, providerId: string, secret: string): string {
  const payload = JSON.parse(secret) as Record<string, unknown>;
  if (payload.keepSavedSecret !== true) return secret;
  const saved = savedPayload(db, authBroker, orgId, providerId);
  if (!saved) throw new Error("There is no saved key to keep; enter the key.");
  delete payload.keepSavedSecret;
  return JSON.stringify({ ...payload, secret: saved.secret });
}
