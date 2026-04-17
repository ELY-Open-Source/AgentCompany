import type { DatabaseSync } from "node:sqlite";
import type { ReadAll, Transaction } from "./helpers";
import { nowIso } from "./helpers";

export type CredentialKind = "oauth" | "api_key" | "aws" | "azure" | "gcp_adc";
export type CredentialStatus = "active" | "expired" | "revoked" | "error";
export type CredentialBackend = "safe_storage" | "vault";

export interface CredentialRow {
  connectorId: string;
  kind: CredentialKind;
  backend: CredentialBackend;
  ciphertext: Uint8Array;
  displayHint: string;
  status: CredentialStatus;
  expiresAt: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCredentialInput {
  connectorId: string;
  kind: CredentialKind;
  backend: CredentialBackend;
  ciphertext: Uint8Array;
  displayHint?: string;
  status?: CredentialStatus;
  expiresAt?: string | null;
  lastRefreshedAt?: string | null;
  lastError?: string | null;
}

function rowToRecord(row: {
  connector_id: string;
  kind: string;
  backend: string;
  ciphertext: Uint8Array;
  display_hint: string;
  status: string;
  expires_at: string | null;
  last_refreshed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}): CredentialRow {
  return {
    connectorId: row.connector_id,
    kind: row.kind as CredentialKind,
    backend: row.backend as CredentialBackend,
    ciphertext: row.ciphertext,
    displayHint: row.display_hint,
    status: row.status as CredentialStatus,
    expiresAt: row.expires_at,
    lastRefreshedAt: row.last_refreshed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildCredentialMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  const COLUMNS =
    "connector_id, kind, backend, ciphertext, display_hint, status, expires_at, last_refreshed_at, last_error, created_at, updated_at";
  type RawRow = {
    connector_id: string;
    kind: string;
    backend: string;
    ciphertext: Uint8Array;
    display_hint: string;
    status: string;
    expires_at: string | null;
    last_refreshed_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  };

  function list(): CredentialRow[] {
    const rows = readAll<RawRow>(
      `select ${COLUMNS} from credentials order by connector_id asc`,
    );
    return rows.map(rowToRecord);
  }

  function get(connectorId: string): CredentialRow | null {
    const rows = readAll<RawRow>(
      `select ${COLUMNS} from credentials where connector_id = ?`,
      connectorId,
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  function upsert(input: UpsertCredentialInput): CredentialRow {
    return transaction(() => {
      const existing = get(input.connectorId);
      const now = nowIso();
      if (existing) {
        getDb()
          .prepare(
            "update credentials set kind = ?, backend = ?, ciphertext = ?, display_hint = ?, status = ?, expires_at = ?, last_refreshed_at = ?, last_error = ?, updated_at = ? where connector_id = ?",
          )
          .run(
            input.kind,
            input.backend,
            input.ciphertext,
            input.displayHint ?? existing.displayHint,
            input.status ?? existing.status,
            input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
            input.lastRefreshedAt === undefined ? existing.lastRefreshedAt : input.lastRefreshedAt,
            input.lastError === undefined ? existing.lastError : input.lastError,
            now,
            input.connectorId,
          );
      } else {
        getDb()
          .prepare(
            "insert into credentials (connector_id, kind, backend, ciphertext, display_hint, status, expires_at, last_refreshed_at, last_error, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            input.connectorId,
            input.kind,
            input.backend,
            input.ciphertext,
            input.displayHint ?? "",
            input.status ?? "active",
            input.expiresAt ?? null,
            input.lastRefreshedAt ?? null,
            input.lastError ?? null,
            now,
            now,
          );
      }
      const record = get(input.connectorId);
      if (!record) throw new Error(`Failed to persist credential: ${input.connectorId}`);
      return record;
    });
  }

  function remove(connectorId: string): void {
    transaction(() => {
      getDb().prepare("delete from credentials where connector_id = ?").run(connectorId);
    });
  }

  function setStatus(
    connectorId: string,
    status: CredentialStatus,
    lastError: string | null = null,
  ): void {
    getDb()
      .prepare(
        "update credentials set status = ?, last_error = ?, updated_at = ? where connector_id = ?",
      )
      .run(status, lastError, nowIso(), connectorId);
  }

  function markRefreshed(
    connectorId: string,
    backend: CredentialBackend,
    ciphertext: Uint8Array,
    expiresAt: string | null,
  ): void {
    const ts = nowIso();
    getDb()
      .prepare(
        "update credentials set backend = ?, ciphertext = ?, expires_at = ?, last_refreshed_at = ?, status = 'active', last_error = null, updated_at = ? where connector_id = ?",
      )
      .run(backend, ciphertext, expiresAt, ts, ts, connectorId);
  }

  return { list, get, upsert, remove, setStatus, markRefreshed };
}
