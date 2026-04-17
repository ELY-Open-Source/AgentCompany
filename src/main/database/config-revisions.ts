import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AgentRecord } from "@shared/types";
import type { ReadAll, SqliteRow, Transaction } from "./helpers";
import { nowIso, parseJson } from "./helpers";

/**
 * Agent config-revision helpers extracted from documents.ts. Spread into
 * the final `buildDocumentMethods` result so AppDatabase call-sites remain
 * unchanged.
 */
export function buildConfigRevisionMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  return {
    recordConfigRevision(input: {
      companyId: string; agentId: string; changedKeys: string[];
      configBefore: Record<string, unknown>; configAfter: Record<string, unknown>;
      source?: string; rolledBackFromRevisionId?: string | null;
      createdByAgentId?: string | null; createdByUserId?: string | null;
    }): string {
      const id = randomUUID();
      const ts = nowIso();
      const lastRev = getDb().prepare(
        "SELECT MAX(revision_number) as maxRev FROM agent_config_revisions WHERE agent_id = ?"
      ).get(input.agentId) as { maxRev: number | null } | undefined;
      const revisionNumber = (lastRev?.maxRev ?? 0) + 1;
      getDb().prepare(
        "INSERT INTO agent_config_revisions (id, company_id, agent_id, revision_number, changed_keys, config_before, config_after, source, rolled_back_from_revision_id, created_by_agent_id, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        id, input.companyId, input.agentId, revisionNumber,
        JSON.stringify(input.changedKeys), JSON.stringify(input.configBefore),
        JSON.stringify(input.configAfter), input.source ?? "patch",
        input.rolledBackFromRevisionId ?? null, input.createdByAgentId ?? null,
        input.createdByUserId ?? null, ts
      );
      return id;
    },

    listConfigRevisions(agentId: string, companyId: string): Array<{
      id: string; agentId: string; revisionNumber: number; changedKeys: string[];
      source: string; rolledBackFromRevisionId: string | null;
      createdByAgentId: string | null; createdByUserId: string | null; createdAt: string;
    }> {
      return readAll<SqliteRow>(
        "SELECT id, agent_id, revision_number, changed_keys, source, rolled_back_from_revision_id, created_by_agent_id, created_by_user_id, created_at FROM agent_config_revisions WHERE agent_id = ? AND company_id = ? ORDER BY revision_number DESC",
        agentId, companyId
      ).map((row) => ({
        id: row.id, agentId: row.agent_id, revisionNumber: row.revision_number,
        changedKeys: parseJson<string[]>(row.changed_keys, []),
        source: row.source, rolledBackFromRevisionId: row.rolled_back_from_revision_id ?? null,
        createdByAgentId: row.created_by_agent_id ?? null,
        createdByUserId: row.created_by_user_id ?? null, createdAt: row.created_at,
      }));
    },

    getConfigRevision(revisionId: string, companyId: string): {
      id: string; agentId: string; revisionNumber: number; changedKeys: string[];
      configBefore: Record<string, unknown>; configAfter: Record<string, unknown>;
      source: string; rolledBackFromRevisionId: string | null;
      createdByAgentId: string | null; createdByUserId: string | null; createdAt: string;
    } {
      const row = getDb().prepare(
        "SELECT * FROM agent_config_revisions WHERE id = ? AND company_id = ?"
      ).get(revisionId, companyId) as {
        id: string; agent_id: string; revision_number: number; changed_keys: string;
        config_before: string; config_after: string; source: string;
        rolled_back_from_revision_id: string | null;
        created_by_agent_id: string | null; created_by_user_id: string | null; created_at: string;
      } | undefined;
      if (!row) throw new Error(`Config revision ${revisionId} not found.`);
      return {
        id: row.id, agentId: row.agent_id, revisionNumber: row.revision_number,
        changedKeys: parseJson<string[]>(row.changed_keys, []),
        configBefore: parseJson<Record<string, unknown>>(row.config_before, {}),
        configAfter: parseJson<Record<string, unknown>>(row.config_after, {}),
        source: row.source, rolledBackFromRevisionId: row.rolled_back_from_revision_id ?? null,
        createdByAgentId: row.created_by_agent_id ?? null,
        createdByUserId: row.created_by_user_id ?? null, createdAt: row.created_at,
      };
    },

    rollbackConfigRevision(agentId: string, revisionId: string, companyId: string, selfDeps: {
      getConfigRevision: (revisionId: string, companyId: string) => {
        id: string; agentId: string; revisionNumber: number; changedKeys: string[];
        configBefore: Record<string, unknown>; configAfter: Record<string, unknown>;
        source: string; rolledBackFromRevisionId: string | null;
        createdByAgentId: string | null; createdByUserId: string | null; createdAt: string;
      };
      getAgent: (id: string) => AgentRecord;
      recordConfigRevision: (input: {
        companyId: string; agentId: string; changedKeys: string[];
        configBefore: Record<string, unknown>; configAfter: Record<string, unknown>;
        source?: string; rolledBackFromRevisionId?: string | null;
        createdByAgentId?: string | null; createdByUserId?: string | null;
      }) => string;
    }): string {
      return transaction(() => {
        const revision = selfDeps.getConfigRevision(revisionId, companyId);
        if (revision.agentId !== agentId) throw new Error("Revision does not belong to this agent.");
        const before = revision.configBefore as Record<string, string | number | null>;
        const ts = nowIso();
        getDb().prepare(
          "UPDATE agents SET name = ?, role = ?, title = ?, department = ?, capabilities = ?, connector_id = ?, model = ?, budget_monthly_usd = ?, metadata_json = ?, updated_at = ? WHERE id = ? AND company_id = ?"
        ).run(
          before.name ?? "", before.role ?? "", before.title ?? "", before.department ?? null,
          before.capabilities ?? "", before.connectorId ?? before.connector_id ?? "",
          before.model ?? null, before.budgetMonthlyUsd ?? before.budget_monthly_usd ?? 0,
          before.metadataJson ?? before.metadata_json ?? "{}", ts, agentId, companyId
        );
        const agent = selfDeps.getAgent(agentId);
        const currentConfig = { name: agent.name, role: agent.role, title: agent.title, department: agent.department, capabilities: agent.capabilities, connectorId: agent.connectorId, model: agent.model, budgetMonthlyUsd: agent.budgetMonthlyUsd, metadataJson: agent.metadataJson };
        return selfDeps.recordConfigRevision({
          companyId, agentId,
          changedKeys: revision.changedKeys,
          configBefore: currentConfig,
          configAfter: before,
          source: "rollback",
          rolledBackFromRevisionId: revisionId,
        });
      });
    },
  };
}
