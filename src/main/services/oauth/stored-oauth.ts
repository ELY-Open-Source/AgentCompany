import { PROVIDER_CATALOG } from "../../../shared/provider-catalog";

/** A provider sign-in as stored: the token, the means to renew it, its expiry, and the extras its backend needs. */
export interface StoredOAuth {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  projectId?: string;
  enterpriseUrl?: string | null;
}

/** Extras a provider's turns cannot run without, with the words used when one is missing. */
const REQUIRED_EXTRAS: Record<string, { field: "accountId" | "projectId"; label: string }> = {
  "gpt-account": { field: "accountId", label: "ChatGPT account id" },
  "google-antigravity": { field: "projectId", label: "Google Cloud project id" },
};

/** The one check of a stored sign-in, used both when it is saved and when a run uses it. */
export function parseStoredOAuth(providerKey: string, secret: string): StoredOAuth {
  const entry = PROVIDER_CATALOG.find((candidate) => candidate.key === providerKey);
  if (!entry) throw new Error(`${providerKey} is not a known provider.`);
  const label = entry.label;
  const value = secret.trim();
  if (!value.startsWith("{")) throw new Error(`Sign in to ${label}; a pasted token cannot be renewed when it expires.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`The stored ${label} sign-in is not valid JSON; sign in again.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`The stored ${label} sign-in is not an object; sign in again.`);
  const creds = parsed as Record<string, unknown>;
  const missing = (what: string) => new Error(`The ${label} sign-in is missing its ${what}; sign in again.`);
  if (typeof creds.access !== "string" || !creds.access.trim()) throw missing("access token");
  if (typeof creds.refresh !== "string" || !creds.refresh.trim()) throw missing("refresh token");
  if (typeof creds.expires !== "number" || !Number.isFinite(creds.expires)) throw missing("expiry");
  const extra = REQUIRED_EXTRAS[providerKey];
  if (extra && (typeof creds[extra.field] !== "string" || !(creds[extra.field] as string).trim())) throw missing(extra.label);
  return creds as unknown as StoredOAuth;
}
