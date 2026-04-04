import type { DatabaseSync } from "node:sqlite";
import { normalizeCommandValue } from "@agentcompany/adapter-utils/server-utils";
import type { ConnectorId, ConnectorRecord } from "@shared/types";
import type { ReadAll } from "./helpers";
import { nowIso } from "./helpers";
import { getConnectorDefinition, buildDefaultConnectorRows } from "../connectors";


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
        configurationDoc: definition.configurationDoc,
        capabilityMatrix: definition.capabilityMatrix,
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

    getConnector(id: ConnectorId): ConnectorRecord {
      const record = readConnectors().find((entry) => entry.id === id);
      if (!record) throw new Error(`Connector not found: ${id}`);
      return record;
    },

    seedConnectors() {
      getDb().prepare("delete from connectors where id not in ('codex_local', 'claude_local', 'gemini_local') and id not like 'claude_compat%'").run();
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
    },
  };
}
