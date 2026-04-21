import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute, resolve as resolvePath, relative as relativePath } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { ReadAll, Transaction } from "./helpers";
import { ensureId, nowIso } from "./helpers";
import { buildConfigRevisionMethods } from "./config-revisions";

function resolveWorkspaceRoot(
  getDb: () => DatabaseSync,
  companyId: string,
  workspaceId: string | null,
  taskId: string | null,
  runId: string | null,
): string | null {
  if (workspaceId) {
    const row = getDb().prepare(
      "SELECT local_path AS localPath FROM workspaces WHERE id = ? AND company_id = ?",
    ).get(workspaceId, companyId) as { localPath: string } | undefined;
    if (row?.localPath) return row.localPath;
  }
  if (taskId) {
    const row = getDb().prepare(
      "SELECT w.local_path AS localPath FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = ? AND t.company_id = ?",
    ).get(taskId, companyId) as { localPath: string } | undefined;
    if (row?.localPath) return row.localPath;
  }
  if (runId) {
    const row = getDb().prepare(
      "SELECT w.local_path AS localPath FROM runs r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ? AND r.company_id = ?",
    ).get(runId, companyId) as { localPath: string } | undefined;
    if (row?.localPath) return row.localPath;
  }
  return null;
}

/**
 * Joins a workspace root with a relative path, refusing paths that escape
 * the workspace (parent-dir traversal or absolute substitution). Returns
 * null when the relative fragment would land outside `root`; the caller
 * treats that as "cannot resolve" and does not open anything.
 */
function joinWorkspaceRelative(root: string, rel: string): string | null {
  if (isAbsolute(rel)) return null;
  const joined = resolvePath(root, rel);
  const within = relativePath(root, joined);
  if (within.startsWith("..") || isAbsolute(within)) return null;
  return joined;
}

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
      companyId: string; taskId: string | null; projectId?: string | null;
      workspaceId?: string | null;
      type: string; provider: string; externalId?: string | null;
      title: string; url?: string | null; status?: string; reviewState?: string;
      isPrimary?: boolean; summary?: string | null; metadataJson?: string | null;
      createdByRunId?: string | null;
    }): string {
      const id = randomUUID();
      const ts = nowIso();
      if (input.isPrimary && input.taskId) {
        getDb().prepare(
          "UPDATE work_products SET is_primary = 0, updated_at = ? WHERE company_id = ? AND task_id = ? AND type = ?",
        ).run(ts, input.companyId, input.taskId, input.type);
      }
      getDb().prepare(
        `INSERT INTO work_products (id, company_id, project_id, task_id, workspace_id, type, provider, external_id, title, url, status, review_state, is_primary, summary, metadata_json, created_by_run_id, last_touched_by_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, input.companyId, input.projectId ?? null, input.taskId ?? null,
        input.workspaceId ?? null,
        input.type, input.provider, input.externalId ?? null,
        input.title, input.url ?? null, input.status ?? "active",
        input.reviewState ?? "none", input.isPrimary ? 1 : 0,
        input.summary ?? null, input.metadataJson ?? null,
        input.createdByRunId ?? null, input.createdByRunId ?? null, ts, ts,
      );
      return id;
    },

    /**
     * Look up a work product by its natural identity. The v45 schema
     * pinned identity to `(companyId, workspaceId, provider, externalId)`
     * so two workspaces with the same relative path no longer collide.
     * When `workspaceId` is null we fall back to the legacy
     * `(companyId, provider, externalId)` scope so historical rows that
     * pre-date the workspace backfill can still be found and updated.
     */
    findWorkProductByExternalId(
      companyId: string,
      provider: string,
      externalId: string,
      workspaceId: string | null,
    ): { id: string; taskId: string | null } | null {
      if (workspaceId) {
        const row = getDb()
          .prepare(
            "SELECT id, task_id as taskId FROM work_products WHERE company_id = ? AND workspace_id = ? AND provider = ? AND external_id = ? LIMIT 1",
          )
          .get(companyId, workspaceId, provider, externalId) as
          | { id: string; taskId: string | null }
          | undefined;
        return row ?? null;
      }
      const row = getDb()
        .prepare(
          "SELECT id, task_id as taskId FROM work_products WHERE company_id = ? AND workspace_id IS NULL AND provider = ? AND external_id = ? LIMIT 1",
        )
        .get(companyId, provider, externalId) as
        | { id: string; taskId: string | null }
        | undefined;
      return row ?? null;
    },

    updateWorkProduct(
      id: string,
      companyId: string,
      patch: {
        type?: string;
        provider?: string;
        externalId?: string | null;
        workspaceId?: string | null;
        title?: string;
        url?: string | null;
        status?: string;
        reviewState?: string;
        isPrimary?: boolean;
        summary?: string | null;
        metadataJson?: string | null;
        lastTouchedByRunId?: string | null;
      },
    ): number {
      const ts = nowIso();
      const sets: string[] = ["updated_at = ?"];
      const values: SQLInputValue[] = [ts];
      const map: Array<[keyof typeof patch, string, (v: unknown) => SQLInputValue]> = [
        ["type", "type", (v) => (v as string) ?? null],
        ["provider", "provider", (v) => (v as string) ?? null],
        ["externalId", "external_id", (v) => (v as string | null) ?? null],
        ["workspaceId", "workspace_id", (v) => (v as string | null) ?? null],
        ["title", "title", (v) => (v as string) ?? null],
        ["url", "url", (v) => (v as string | null) ?? null],
        ["status", "status", (v) => (v as string) ?? null],
        ["reviewState", "review_state", (v) => (v as string) ?? null],
        ["isPrimary", "is_primary", (v) => (v ? 1 : 0)],
        ["summary", "summary", (v) => (v as string | null) ?? null],
        ["metadataJson", "metadata_json", (v) => (v as string | null) ?? null],
        ["lastTouchedByRunId", "last_touched_by_run_id", (v) => (v as string | null) ?? null],
      ];
      for (const [key, col, coerce] of map) {
        if (key in patch) {
          sets.push(`${col} = ?`);
          values.push(coerce(patch[key]));
        }
      }
      values.push(id, companyId);
      const result = getDb()
        .prepare(`UPDATE work_products SET ${sets.join(", ")} WHERE id = ? AND company_id = ?`)
        .run(...values);
      return Number(result.changes ?? 0);
    },

    /**
     * Resolves the absolute filesystem (or URL) target for a work product.
     *
     * Filesystem artifacts are stored as `external_id = <workspace-relative
     * path>` to stay portable across workspace-root moves; `shell.openPath`
     * needs an absolute managed path, so the renderer can't just forward
     * the external id. This method joins the work-product row back to its
     * originating task → workspace, or — for taskless runs — through the
     * creating run, so the caller gets either a URL (non-filesystem
     * artifact) or a concrete absolute path that downstream
     * `canOpenPath` validates.
     */
    resolveWorkProductTarget(
      workProductId: string,
      companyId: string,
    ):
      | { kind: "url" | "path"; value: string }
      | { kind: "error"; reason: "not_found" | "archived" | "no_target" | "workspace_unresolved" | "path_escape"; detail: string } {
      const row = getDb().prepare(
        "SELECT provider, external_id, url, status, task_id, created_by_run_id, last_touched_by_run_id, workspace_id FROM work_products WHERE id = ? AND company_id = ?",
      ).get(workProductId, companyId) as
        | { provider: string; external_id: string | null; url: string | null; status: string; task_id: string | null; created_by_run_id: string | null; last_touched_by_run_id: string | null; workspace_id: string | null }
        | undefined;
      if (!row) return { kind: "error", reason: "not_found", detail: `No work_product row with id=${workProductId}` };
      if (row.status === "archived") return { kind: "error", reason: "archived", detail: "Work product is archived (retirement tombstone)" };

      if (row.url && row.url.length > 0) {
        return { kind: "url", value: row.url };
      }
      if (row.provider !== "filesystem" || !row.external_id) {
        return { kind: "error", reason: "no_target", detail: `provider=${row.provider} external_id=${row.external_id ?? "null"} url=null` };
      }

      const workspaceRoot = resolveWorkspaceRoot(
        getDb,
        companyId,
        row.workspace_id,
        row.task_id,
        row.last_touched_by_run_id ?? row.created_by_run_id,
      );
      if (workspaceRoot) {
        const absolute = joinWorkspaceRelative(workspaceRoot, row.external_id);
        if (!absolute) {
          return { kind: "error", reason: "path_escape", detail: `external_id=${row.external_id} escapes workspace root ${workspaceRoot}` };
        }
        return { kind: "path", value: absolute };
      }

      // Fourth-tier heal: orphan rows created before the projector tracked
      // workspace_id end-to-end lose the link through all three joins. If
      // the externalId resolves to a real file inside the company's
      // observation (primary/oldest) workspace, we treat that as the
      // canonical root for this row. No guessing across all workspaces —
      // just one deterministic fallback, and it only fires when the file
      // actually exists on disk so the shell never sees a phantom path.
      const observation = getDb()
        .prepare(
          "SELECT local_path as localPath FROM workspaces WHERE company_id = ? AND local_path IS NOT NULL ORDER BY is_primary DESC, created_at ASC LIMIT 1",
        )
        .get(companyId) as { localPath: string } | undefined;
      if (observation?.localPath) {
        const candidate = joinWorkspaceRelative(observation.localPath, row.external_id);
        if (candidate) {
          try {
            if (statSync(candidate).isFile()) {
              return { kind: "path", value: candidate };
            }
          } catch {
            // fall through to error below
          }
        }
      }
      return {
        kind: "error",
        reason: "workspace_unresolved",
        detail: `workspace_id=${row.workspace_id ?? "null"} task_id=${row.task_id ?? "null"} run_id=${row.last_touched_by_run_id ?? row.created_by_run_id ?? "null"} — none led to a workspace with a local_path, and ${row.external_id} is not present in the company's observation workspace${observation?.localPath ? ` (${observation.localPath})` : " (no observation workspace exists)"}`,
      };
    },

    // Task-scoped visible listing. Archived rows stay in the table as
    // retirement tombstones; the task API and the thread view only
    // surface currently-active deliverables so a deleted file stops
    // appearing in the task's artifact strip.
    listWorkProductsForTask(taskId: string, companyId: string) {
      return readAll<{
        id: string; company_id: string; project_id: string | null; task_id: string;
        workspace_id: string | null;
        type: string; provider: string; external_id: string | null; title: string;
        url: string | null; status: string; review_state: string; is_primary: number;
        summary: string | null; metadata_json: string | null;
        created_by_run_id: string | null; last_touched_by_run_id: string | null;
        created_at: string; updated_at: string;
      }>(
        "SELECT * FROM work_products WHERE task_id = ? AND company_id = ? AND status <> 'archived' ORDER BY is_primary DESC, updated_at DESC",
        taskId, companyId,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, projectId: r.project_id, taskId: r.task_id,
        workspaceId: r.workspace_id,
        type: r.type, provider: r.provider, externalId: r.external_id, title: r.title,
        url: r.url, status: r.status, reviewState: r.review_state,
        isPrimary: Boolean(r.is_primary), summary: r.summary,
        metadataJson: r.metadata_json, createdByRunId: r.created_by_run_id,
        lastTouchedByRunId: r.last_touched_by_run_id,
        createdAt: r.created_at, updatedAt: r.updated_at,
      }));
    },

    /**
     * Company-scoped work-product listing, newest first. Used by the
     * renderer snapshot so the DocumentCenter can surface filesystem
     * artifacts (type = "file") the agents produce via bash/write/edit.
     * Archived rows are excluded so retired files stop showing in the
     * operator UI; callers that need the full audit trail go through
     * `listArchivedWorkProductsForCompany`.
     */
    listWorkProductsForCompany(companyId: string, limit = 500) {
      return readAll<{
        id: string; company_id: string; project_id: string | null; task_id: string | null;
        workspace_id: string | null;
        type: string; provider: string; external_id: string | null; title: string;
        url: string | null; status: string; review_state: string; is_primary: number;
        summary: string | null; metadata_json: string | null;
        created_by_run_id: string | null; last_touched_by_run_id: string | null;
        created_at: string; updated_at: string;
      }>(
        "SELECT * FROM work_products WHERE company_id = ? AND status <> 'archived' ORDER BY updated_at DESC LIMIT ?",
        companyId, limit,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, projectId: r.project_id, taskId: r.task_id,
        workspaceId: r.workspace_id,
        type: r.type, provider: r.provider, externalId: r.external_id, title: r.title,
        url: r.url, status: r.status, reviewState: r.review_state,
        isPrimary: Boolean(r.is_primary), summary: r.summary,
        metadataJson: r.metadata_json, createdByRunId: r.created_by_run_id,
        lastTouchedByRunId: r.last_touched_by_run_id,
        createdAt: r.created_at, updatedAt: r.updated_at,
      }));
    },

    deleteWorkProduct(id: string, companyId: string): number {
      const result = getDb()
        .prepare("DELETE FROM work_products WHERE id = ? AND company_id = ?")
        .run(id, companyId);
      return Number(result.changes ?? 0);
    },

    /**
     * Archive every `work_products` row whose natural identity matches
     * one of `paths` under the given `(companyId, workspaceId,
     * provider)` scope. The change detectors walk the whole workspace
     * delta, so every detected deletion has to be retired — previously
     * the projector capped the retire list at a hardcoded budget and
     * the tail stayed visible in the DocumentCenter.
     *
     * Runs as a single `UPDATE … WHERE external_id IN (…)` per chunk
     * so bulk deletions cost one SQL round-trip per 500 paths instead
     * of one per path. `RETURNING` carries the archived row ids back
     * to the projector so it can emit `retired` outcomes without a
     * follow-up SELECT.
     */
    archiveWorkProductsByExternalPaths(input: {
      companyId: string;
      workspaceId: string | null;
      provider: string;
      paths: string[];
      lastTouchedByRunId: string | null;
    }): Array<{ id: string; externalId: string }> {
      if (input.paths.length === 0) return [];
      const ts = nowIso();
      const CHUNK = 500;
      const workspaceClause = input.workspaceId
        ? "AND workspace_id = ?"
        : "AND workspace_id IS NULL";
      const results: Array<{ id: string; externalId: string }> = [];
      for (let i = 0; i < input.paths.length; i += CHUNK) {
        const chunk = input.paths.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => "?").join(", ");
        const params: SQLInputValue[] = [
          input.lastTouchedByRunId ?? null,
          ts,
          input.companyId,
          input.provider,
        ];
        if (input.workspaceId) params.push(input.workspaceId);
        params.push(...chunk);
        const rows = readAll<{ id: string; external_id: string }>(
          `UPDATE work_products
              SET status = 'archived',
                  last_touched_by_run_id = ?,
                  updated_at = ?
            WHERE company_id = ?
              AND provider = ?
              ${workspaceClause}
              AND external_id IN (${placeholders})
              AND status <> 'archived'
          RETURNING id, external_id`,
          ...params,
        );
        for (const row of rows) {
          results.push({ id: row.id, externalId: row.external_id });
        }
      }
      return results;
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
