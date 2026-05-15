import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalizeJsonString, jsonStringArraySchema } from "@shared/contracts";
import type { ReadAll, Transaction } from "./helpers";
import { ensureId, nowIso } from "./helpers";
import { buildConfigRevisionMethods } from "./config-revisions";
import { buildWorkProductMethods } from "./documents-work-products";

/**
 * Document row shape returned by listDocuments — used by
 * GET /api/companies/:companyId/documents. Mirrors the historical inline
 * SQL projection so HTTP response bodies stay byte-stable for clients.
 */
export type DocumentListRow = {
  id: string;
  companyId: string;
  type: string;
  title: string;
  content: string;
  authorAgentId: string;
  reviewerAgentId: string | null;
  projectId: string | null;
  goalId: string | null;
  parentDocId: string | null;
  version: number;
  status: string;
  tagsJson: string;
  latestRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Document lookup row used by the PATCH document handler — narrower
 * projection without parent_doc_id / latest_revision_id / timestamps.
 */
export type DocumentLookupRow = {
  id: string;
  companyId: string;
  type: string;
  title: string;
  content: string;
  authorAgentId: string;
  reviewerAgentId: string | null;
  projectId: string | null;
  goalId: string | null;
  version: number;
  status: string;
  tagsJson: string;
};

export function buildDocumentMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  return {
    ...buildConfigRevisionMethods(getDb, readAll, transaction),
    ...buildWorkProductMethods(getDb, readAll, transaction),
    saveDocument(input: {
      id?: string | null; companyId: string; type: string; title: string; content?: string;
      authorAgentId?: string | null; reviewerAgentId?: string | null; projectId?: string | null;
      goalId?: string | null; parentDocId?: string | null; version?: number; status?: string; tagsJson?: string;
      sourceRunId?: string | null;
    }) {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const existing = getDb().prepare(
        "select company_id as companyId from documents where id = ?",
      ).get(id) as { companyId: string } | undefined;
      if (existing && existing.companyId !== input.companyId) {
        throw new Error(`Document ${id} does not belong to company ${input.companyId}`);
      }
      const tagsJson = canonicalizeJsonString(input.tagsJson, jsonStringArraySchema, []);
      if (existing) {
        getDb().prepare(
          "update documents set type = ?, title = ?, content = ?, author_agent_id = ?, reviewer_agent_id = ?, project_id = ?, goal_id = ?, parent_doc_id = ?, version = ?, status = ?, tags_json = ?, source_run_id = coalesce(?, source_run_id), updated_at = ? where id = ? and company_id = ?",
        ).run(input.type, input.title, input.content ?? "", input.authorAgentId ?? null, input.reviewerAgentId ?? null, input.projectId ?? null, input.goalId ?? null, input.parentDocId ?? null, input.version ?? 1, input.status ?? "draft", tagsJson, input.sourceRunId ?? null, ts, id, input.companyId);
      } else {
        getDb().prepare(
          "insert into documents (id, company_id, type, title, content, author_agent_id, reviewer_agent_id, project_id, goal_id, parent_doc_id, version, status, tags_json, source_run_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, input.companyId, input.type, input.title, input.content ?? "", input.authorAgentId ?? null, input.reviewerAgentId ?? null, input.projectId ?? null, input.goalId ?? null, input.parentDocId ?? null, input.version ?? 1, input.status ?? "draft", tagsJson, input.sourceRunId ?? null, ts, ts);
      }
      return id;
    },

    /**
     * Returns all documents for a company, ordered by updated_at desc.
     * Used by GET /api/companies/:companyId/documents.
     */
    listDocuments(companyId: string): DocumentListRow[] {
      return readAll<DocumentListRow>(
        "select id, company_id as companyId, type, title, content, author_agent_id as authorAgentId, reviewer_agent_id as reviewerAgentId, project_id as projectId, goal_id as goalId, parent_doc_id as parentDocId, version, status, tags_json as tagsJson, latest_revision_id as latestRevisionId, created_at as createdAt, updated_at as updatedAt from documents where company_id = ? order by updated_at desc",
        companyId,
      ).map((d) => ({ ...d, latestRevisionId: d.latestRevisionId ?? null }));
    },

    /**
     * Returns the lookup row needed for PATCH /api/companies/:companyId/documents/:documentId.
     * Returns null when the document is missing or belongs to another company.
     */
    getDocumentForUpdate(
      documentId: string,
      companyId: string,
    ): DocumentLookupRow | null {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, type, title, content, author_agent_id as authorAgentId, reviewer_agent_id as reviewerAgentId, project_id as projectId, goal_id as goalId, version, status, tags_json as tagsJson from documents where id = ? and company_id = ? limit 1",
        )
        .get(documentId, companyId) as DocumentLookupRow | undefined;
      return row ?? null;
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
        "UPDATE documents SET version = ?, latest_revision_id = ?, updated_at = ? WHERE id = ? AND company_id = ?",
      ).run(revisionNumber, id, ts, input.documentId, input.companyId);
      return { id, revisionNumber };
    },

    getDocumentLatestRevisionId(documentId: string, companyId: string): string | null {
      const row = getDb().prepare(
        "SELECT latest_revision_id FROM documents WHERE id = ? AND company_id = ?",
      ).get(documentId, companyId) as { latest_revision_id: string | null } | undefined;
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

  };
}
