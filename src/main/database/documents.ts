import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { AgentRecord } from "@shared/types";
import type { ReadAll, SqliteRow, Transaction } from "./helpers";
import { ensureId, nowIso, parseJson } from "./helpers";

export function buildDocumentMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  return {
    saveDocument(input: {
      id?: string | null; companyId: string; type: string; title: string; content?: string;
      authorAgentId?: string | null; reviewerAgentId?: string | null; projectId?: string | null;
      goalId?: string | null; parentDocId?: string | null; version?: number; status?: string; tagsJson?: string;
      sourceRunId?: string | null;
    }) {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const existing = getDb().prepare("select id from documents where id = ?").get(id) as { id: string } | undefined;
      if (existing) {
        getDb().prepare(
          "update documents set type = ?, title = ?, content = ?, author_agent_id = ?, reviewer_agent_id = ?, project_id = ?, goal_id = ?, parent_doc_id = ?, version = ?, status = ?, tags_json = ?, source_run_id = coalesce(?, source_run_id), updated_at = ? where id = ?",
        ).run(input.type, input.title, input.content ?? "", input.authorAgentId ?? null, input.reviewerAgentId ?? null, input.projectId ?? null, input.goalId ?? null, input.parentDocId ?? null, input.version ?? 1, input.status ?? "draft", input.tagsJson ?? "[]", input.sourceRunId ?? null, ts, id);
      } else {
        getDb().prepare(
          "insert into documents (id, company_id, type, title, content, author_agent_id, reviewer_agent_id, project_id, goal_id, parent_doc_id, version, status, tags_json, source_run_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, input.companyId, input.type, input.title, input.content ?? "", input.authorAgentId ?? null, input.reviewerAgentId ?? null, input.projectId ?? null, input.goalId ?? null, input.parentDocId ?? null, input.version ?? 1, input.status ?? "draft", input.tagsJson ?? "[]", input.sourceRunId ?? null, ts, ts);
      }
      return id;
    },

    updateDocumentStatus(id: string, companyId: string, status: string): void {
      getDb().prepare(
        "UPDATE documents SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?",
      ).run(status, nowIso(), id, companyId);
    },

    deleteDocument(id: string, companyId: string) {
      getDb().prepare("delete from documents where id = ? and company_id = ?").run(id, companyId);
    },

    createDocumentRevision(input: {
      documentId: string; companyId: string; body: string;
      changeSummary?: string | null; createdByAgentId?: string | null; createdByUserId?: string | null;
    }): { id: string; revisionNumber: number } {
      const id = randomUUID();
      const ts = nowIso();
      const current = getDb().prepare(
        "SELECT version FROM documents WHERE id = ? AND company_id = ?",
      ).get(input.documentId, input.companyId) as { version: number } | undefined;
      if (!current) throw new Error(`Document ${input.documentId} not found`);
      const revisionNumber = current.version + 1;
      getDb().prepare(
        "INSERT INTO document_revisions (id, company_id, document_id, revision_number, body, change_summary, created_by_agent_id, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, input.companyId, input.documentId, revisionNumber, input.body, input.changeSummary ?? null, input.createdByAgentId ?? null, input.createdByUserId ?? null, ts);
      getDb().prepare(
        "UPDATE documents SET version = ?, latest_revision_id = ?, updated_at = ? WHERE id = ?",
      ).run(revisionNumber, id, ts, input.documentId);
      return { id, revisionNumber };
    },

    getDocumentLatestRevisionId(documentId: string): string | null {
      const row = getDb().prepare(
        "SELECT latest_revision_id FROM documents WHERE id = ?",
      ).get(documentId) as { latest_revision_id: string | null } | undefined;
      return row?.latest_revision_id ?? null;
    },

    /**
     * Returns up to `limit` documents of the given types for a company that
     * are either authored by `authorAgentId` or were created at/after the
     * task's createdAt. Used by the deliverable-review gate when a task is
     * advanced to "done".
     */
    listImportantDocsForReview(input: {
      companyId: string;
      types: readonly string[];
      authorAgentId: string | null;
      taskId: string;
      limit?: number;
    }): Array<{ id: string; type: string; title: string }> {
      const limit = input.limit ?? 10;
      const placeholders = input.types.map(() => "?").join(", ");
      return readAll<{ id: string; type: string; title: string }>(
        `select id, type, title from documents where company_id = ? and type in (${placeholders})
           and (author_agent_id = ? or created_at >= (select created_at from tasks where id = ?))
           order by created_at desc limit ?`,
        input.companyId,
        ...input.types,
        input.authorAgentId ?? "",
        input.taskId,
        limit,
      );
    },

    listDocumentRevisions(documentId: string, companyId: string) {
      return readAll<{
        id: string; company_id: string; document_id: string; revision_number: number;
        body: string; change_summary: string | null; created_by_agent_id: string | null;
        created_by_user_id: string | null; created_at: string;
      }>(
        "SELECT id, company_id, document_id, revision_number, body, change_summary, created_by_agent_id, created_by_user_id, created_at FROM document_revisions WHERE document_id = ? AND company_id = ? ORDER BY revision_number ASC",
        documentId, companyId,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, documentId: r.document_id,
        revisionNumber: r.revision_number, body: r.body,
        changeSummary: r.change_summary, createdByAgentId: r.created_by_agent_id,
        createdByUserId: r.created_by_user_id, createdAt: r.created_at,
      }));
    },

    // ── Work Products ──

    createWorkProduct(input: {
      companyId: string; taskId: string; projectId?: string | null;
      type: string; provider: string; externalId?: string | null;
      title: string; url?: string | null; status?: string; reviewState?: string;
      isPrimary?: boolean; summary?: string | null; metadataJson?: string | null;
      createdByRunId?: string | null;
    }): string {
      const id = randomUUID();
      const ts = nowIso();
      if (input.isPrimary) {
        getDb().prepare(
          "UPDATE work_products SET is_primary = 0, updated_at = ? WHERE company_id = ? AND task_id = ? AND type = ?",
        ).run(ts, input.companyId, input.taskId, input.type);
      }
      getDb().prepare(
        `INSERT INTO work_products (id, company_id, project_id, task_id, type, provider, external_id, title, url, status, review_state, is_primary, summary, metadata_json, created_by_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, input.companyId, input.projectId ?? null, input.taskId,
        input.type, input.provider, input.externalId ?? null,
        input.title, input.url ?? null, input.status ?? "active",
        input.reviewState ?? "none", input.isPrimary ? 1 : 0,
        input.summary ?? null, input.metadataJson ?? null,
        input.createdByRunId ?? null, ts, ts,
      );
      return id;
    },

    updateWorkProduct(id: string, companyId: string, patch: Record<string, unknown>): void {
      const ts = nowIso();
      const sets: string[] = ["updated_at = ?"];
      const values: unknown[] = [ts];
      const ALLOWED = new Set(["type", "provider", "external_id", "title", "url", "status", "review_state", "is_primary", "summary", "metadata_json"]);
      for (const [key, value] of Object.entries(patch)) {
        const col = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        if (ALLOWED.has(col)) {
          sets.push(`${col} = ?`);
          values.push(col === "is_primary" ? (value ? 1 : 0) : value ?? null);
        }
      }
      values.push(id, companyId);
      getDb().prepare(`UPDATE work_products SET ${sets.join(", ")} WHERE id = ? AND company_id = ?`).run(...(values as SQLInputValue[]));
    },

    listWorkProductsForTask(taskId: string, companyId: string) {
      return readAll<{
        id: string; company_id: string; project_id: string | null; task_id: string;
        type: string; provider: string; external_id: string | null; title: string;
        url: string | null; status: string; review_state: string; is_primary: number;
        summary: string | null; metadata_json: string | null; created_by_run_id: string | null;
        created_at: string; updated_at: string;
      }>(
        "SELECT * FROM work_products WHERE task_id = ? AND company_id = ? ORDER BY is_primary DESC, updated_at DESC",
        taskId, companyId,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, projectId: r.project_id, taskId: r.task_id,
        type: r.type, provider: r.provider, externalId: r.external_id, title: r.title,
        url: r.url, status: r.status, reviewState: r.review_state,
        isPrimary: Boolean(r.is_primary), summary: r.summary,
        metadataJson: r.metadata_json, createdByRunId: r.created_by_run_id,
        createdAt: r.created_at, updatedAt: r.updated_at,
      }));
    },

    deleteWorkProduct(id: string, companyId: string): void {
      getDb().prepare("DELETE FROM work_products WHERE id = ? AND company_id = ?").run(id, companyId);
    },

    // ── Task-Document Links ──

    linkDocumentToTask(taskId: string, documentId: string, companyId: string, key: string): string {
      const id = randomUUID();
      const ts = nowIso();
      getDb().prepare(
        "INSERT OR REPLACE INTO task_documents (id, company_id, task_id, document_id, key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(id, companyId, taskId, documentId, key.toLowerCase(), ts, ts);
      return id;
    },

    unlinkDocumentFromTask(taskId: string, key: string, companyId: string): void {
      getDb().prepare(
        "DELETE FROM task_documents WHERE task_id = ? AND key = ? AND company_id = ?",
      ).run(taskId, key.toLowerCase(), companyId);
    },

    listDocumentsForTask(taskId: string, companyId: string) {
      return readAll<{
        id: string; company_id: string; task_id: string; document_id: string;
        key: string; created_at: string; updated_at: string;
      }>(
        "SELECT * FROM task_documents WHERE task_id = ? AND company_id = ? ORDER BY key ASC",
        taskId, companyId,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, taskId: r.task_id,
        documentId: r.document_id, key: r.key,
        createdAt: r.created_at, updatedAt: r.updated_at,
      }));
    },

    // ── Config Revisions ──

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
