import type { DatabaseSync } from "node:sqlite";
import type { ConnectorId, ConnectorRecord } from "@shared/types";
import type { ReadAll } from "./helpers";
import { nowIso } from "./helpers";
import { normalizeCommandValue } from "../connector-helpers";
import {
  CONNECTORS,
  getConnectorDefinition,
  buildDefaultConnectorRows,
  renderConnectorConfigurationDoc,
  PI_MONO_CAPABILITIES,
} from "../connectors";


export function buildConnectorMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
) {
  function readConnectors(): ConnectorRecord[] {
    const rows = readAll<{
      id: string; label: string; description: string; status: ConnectorRecord["status"];
      command: string; version: string | null; auth_state: ConnectorRecord["authState"];
      last_checked_at: string | null; last_error: string | null; model: string | null;
      env_binding_text: string; notes: string;
    }>(
      "select id, label, description, status, command, version, auth_state, last_checked_at, last_error, model, env_binding_text, notes from connectors order by label asc",
    );
    const result: ConnectorRecord[] = [];
    for (const row of rows) {
      let definition;
      try {
        definition = getConnectorDefinition(row.id as ConnectorId);
      } catch {
        continue;
      }
      result.push({
        id: row.id as ConnectorId,
        label: row.label,
        description: row.description,
        status: row.status,
        command: normalizeCommandValue(row.command),
        version: row.version,
        authState: row.auth_state,
        lastCheckedAt: row.last_checked_at,
        lastError: row.last_error,
        model: row.model,
        envBindingText: row.env_binding_text,
        notes: row.notes,
        configurationDoc: renderConnectorConfigurationDoc(definition),
        capabilityMatrix: PI_MONO_CAPABILITIES,
      });
    }
    return result;
  }

  return {
    readConnectors,

    saveConnector(input: {
      id: ConnectorId;
      command: string;
      model: string | null;
      envBindingText: string;
      notes: string;
    }) {
      const normalizedCommand = normalizeCommandValue(input.command);
      getDb()
        .prepare(
          "update connectors set command = ?, model = ?, env_binding_text = ?, notes = ?, updated_at = ? where id = ?",
        )
        .run(normalizedCommand, input.model, input.envBindingText, input.notes, nowIso(), input.id);
    },

    updateConnectorHealth(input: {
      id: ConnectorId;
      status: string;
      authState: string;
      version: string | null;
      lastError: string | null;
    }) {
      getDb()
        .prepare(
          "update connectors set status = ?, auth_state = ?, version = ?, last_checked_at = ?, last_error = ?, updated_at = ? where id = ?",
        )
        .run(input.status, input.authState, input.version, nowIso(), input.lastError, nowIso(), input.id);
    },

    findConnector(id: ConnectorId): ConnectorRecord | null {
      const row = getDb()
        .prepare(
          "select id, label, description, status, command, version, auth_state, last_checked_at, last_error, model, env_binding_text, notes from connectors where id = ?",
        )
        .get(id) as
        | {
            id: string;
            label: string;
            description: string;
            status: ConnectorRecord["status"];
            command: string;
            version: string | null;
            auth_state: ConnectorRecord["authState"];
            last_checked_at: string | null;
            last_error: string | null;
            model: string | null;
            env_binding_text: string;
            notes: string;
          }
        | undefined;
      if (!row) return null;
      let definition;
      try {
        definition = getConnectorDefinition(row.id as ConnectorId);
      } catch {
        return null;
      }
      return {
        id: row.id as ConnectorId,
        label: row.label,
        description: row.description,
        status: row.status,
        command: normalizeCommandValue(row.command),
        version: row.version,
        authState: row.auth_state,
        lastCheckedAt: row.last_checked_at,
        lastError: row.last_error,
        model: row.model,
        envBindingText: row.env_binding_text,
        notes: row.notes,
        configurationDoc: renderConnectorConfigurationDoc(definition),
        capabilityMatrix: PI_MONO_CAPABILITIES,
      };
    },

    getConnector(id: ConnectorId): ConnectorRecord {
      const result = this.findConnector(id);
      if (!result) throw new Error(`Connector not found: ${id}`);
      return result;
    },

    seedConnectors() {
      // Drop any connector row that is not declared in the pi-mono catalog.
      const validIds = CONNECTORS.map((c) => `'${c.id}'`).join(",");
      getDb().prepare(`delete from connectors where id not in (${validIds})`).run();

      const currentRows = readAll<Partial<ConnectorRecord>>(
        "select id, label, description, status, command, version, auth_state as authState, last_checked_at as lastCheckedAt, last_error as lastError, model, env_binding_text as envBindingText, notes from connectors",
      );

      const merged = buildDefaultConnectorRows(currentRows);
      const statement = getDb().prepare(
        "insert or replace into connectors (id, label, description, status, command, version, auth_state, last_checked_at, last_error, model, env_binding_text, notes, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const updatedAt = nowIso();
      for (const row of merged) {
        statement.run(
          row.id, row.label, row.description, row.status,
          row.command, row.version, row.authState, row.lastCheckedAt,
          row.lastError, row.model, row.envBindingText, row.notes, updatedAt,
        );
      }

      // One-time migration: mark connectors actively used by agents as
      // model-pool-managed so they remain visible to the CEO after the opt-in
      // policy change. Connectors not used by any agent stay unmanaged and
      // will not appear in CEO prompts until the user explicitly enables
      // models for them in Settings > Model Management.
      const migrationKey = "migration:model_pool_opt_in_v1";
      const migrated = readAll<{ value: string }>("SELECT value FROM settings WHERE key = ?", migrationKey);
      if (migrated.length === 0) {
        const usedIds = new Set(
          readAll<{ connector_id: string }>(
            "SELECT DISTINCT connector_id FROM agents WHERE status NOT IN ('terminated')",
          ).map((r) => r.connector_id),
        );
        const upsert = getDb().prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        );
        for (const id of usedIds) {
          const hasSettings = readAll<{ key: string }>(
            "SELECT key FROM settings WHERE key = ?",
            `disabled_models:${id}`,
          );
          if (hasSettings.length === 0) {
            upsert.run(`disabled_models:${id}`, "[]");
          }
        }
        upsert.run(migrationKey, "1");
      }
    },
  };
}
