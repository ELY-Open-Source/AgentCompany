import type { AppDatabase } from "@main/database";
import type { CredentialBackend, CredentialKind } from "@main/database/credentials";
import type { CredentialStatus } from "@main/database/credentials";
import { credentialPayloadSchema, type CredentialSummary } from "@shared/contracts/schemas-credentials";
import { z } from "zod";
import { UpstreamError } from "../errors/index.js";
import type { StoredCredentialPayload } from "./types";

const HINT_SUFFIX_LEN = 4;
const HINT_PREFIX_LEN = 6;

const oauthCredentialPayloadSchema = z.object({
  refresh: z.string().min(1),
  access: z.string().min(1),
  expires: z.number().finite(),
}).passthrough();

const storedCredentialPayloadSchema = z.union([
  credentialPayloadSchema,
  z.object({ kind: z.literal("oauth"), value: oauthCredentialPayloadSchema }),
]);

export class CredentialStoreReadError extends UpstreamError {
  readonly connectorId: string;

  constructor(connectorId: string, message: string) {
    super({
      code: "CREDENTIAL_INVALID",
      message,
      context: { connectorId },
    });
    this.name = "CredentialStoreReadError";
    this.connectorId = connectorId;
  }
}

function maskApiKey(value: string): string {
  if (value.length <= HINT_PREFIX_LEN + HINT_SUFFIX_LEN) {
    return `${value.slice(0, 2)}...`;
  }
  const prefix = value.slice(0, HINT_PREFIX_LEN);
  const suffix = value.slice(-HINT_SUFFIX_LEN);
  return `${prefix}...${suffix}`;
}

export function deriveDisplayHint(payload: StoredCredentialPayload): string {
  switch (payload.kind) {
    case "api_key":
      return payload.value.source === "literal"
        ? maskApiKey(payload.value.value)
        : `env:${payload.value.value}`;
    case "azure":
      return payload.value.resourceName
        ? `azure:${payload.value.resourceName}`
        : `azure:${maskApiKey(payload.value.apiKey)}`;
    case "aws":
      if (payload.value.authMode === "profile") return `aws:profile=${payload.value.awsProfile ?? "?"}`;
      if (payload.value.authMode === "iam") return `aws:iam=${maskApiKey(payload.value.accessKeyId ?? "?")}`;
      return `aws:bearer`;
    case "gcp_adc":
      return `gcp:${payload.value.project}@${payload.value.location}`;
    case "oauth": {
      const expiresMs = payload.value.expires;
      const expiresLabel = typeof expiresMs === "number" && Number.isFinite(expiresMs)
        ? new Date(expiresMs).toISOString()
        : "no-expiry";
      return `oauth:expires=${expiresLabel}`;
    }
    case "local":
      return `local:${payload.value.baseUrl}`;
  }
}

export interface CredentialStoreDeps {
  db: AppDatabase;
}

function formatCredentialPayloadError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "payload";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function parseStoredCredentialPayload(
  connectorId: string,
  kind: CredentialKind,
  json: string,
): StoredCredentialPayload {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new CredentialStoreReadError(connectorId, "Stored credential payload is not valid JSON.");
  }
  const parsed = storedCredentialPayloadSchema.safeParse({ kind, value });
  if (!parsed.success) {
    throw new CredentialStoreReadError(
      connectorId,
      `Stored credential payload failed schema validation: ${formatCredentialPayloadError(parsed.error)}`,
    );
  }
  return parsed.data as StoredCredentialPayload;
}

export class CredentialStore {
  constructor(private readonly deps: CredentialStoreDeps) {}

  list(): CredentialSummary[] {
    return this.deps.db.core.credentials.list().map((row) => ({
      connectorId: row.connectorId,
      kind: row.kind as CredentialKind,
      displayHint: row.displayHint,
      status: row.status,
      expiresAt: row.expiresAt,
      lastRefreshedAt: row.lastRefreshedAt,
      lastError: row.lastError,
      updatedAt: row.updatedAt,
    }));
  }

  /** Encrypts and stores a credential. Caller is responsible for kind/connectorId match. */
  save(connectorId: string, payload: StoredCredentialPayload, expiresAt: string | null = null): CredentialSummary {
    const json = JSON.stringify(payload.value);
    const { backend, payload: ciphertext } = this.deps.db.vault.encrypt(json);
    const stored = this.deps.db.core.credentials.upsert({
      connectorId,
      kind: payload.kind,
      backend: backend as CredentialBackend,
      ciphertext,
      displayHint: deriveDisplayHint(payload),
      status: "active",
      expiresAt,
      lastRefreshedAt: null,
      lastError: null,
    });
    return {
      connectorId: stored.connectorId,
      kind: stored.kind,
      displayHint: stored.displayHint,
      status: stored.status,
      expiresAt: stored.expiresAt,
      lastRefreshedAt: stored.lastRefreshedAt,
      lastError: stored.lastError,
      updatedAt: stored.updatedAt,
    };
  }

  /** Decrypts and returns the typed credential payload. Returns null when missing. */
  read(connectorId: string): StoredCredentialPayload | null {
    const row = this.deps.db.core.credentials.get(connectorId);
    if (!row) return null;
    const json = this.deps.db.vault.decrypt(
      row.backend,
      Buffer.isBuffer(row.ciphertext) ? row.ciphertext : Buffer.from(row.ciphertext),
    );
    return parseStoredCredentialPayload(connectorId, row.kind, json);
  }

  remove(connectorId: string): void {
    this.deps.db.core.credentials.remove(connectorId);
  }

  setStatus(connectorId: string, status: CredentialStatus, lastError: string | null = null): void {
    this.deps.db.core.credentials.setStatus(connectorId, status, lastError);
  }

  /** Replaces the OAuth ciphertext after a successful refresh. */
  saveRefreshedOAuth(connectorId: string, payload: StoredCredentialPayload, expiresAt: string | null): void {
    const { backend, payload: ciphertext } = this.deps.db.vault.encrypt(JSON.stringify(payload.value));
    this.deps.db.core.credentials.markRefreshed(
      connectorId,
      backend as CredentialBackend,
      ciphertext,
      expiresAt,
    );
  }
}
