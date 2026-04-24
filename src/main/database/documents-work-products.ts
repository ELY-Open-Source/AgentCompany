import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute, resolve as resolvePath, relative as relativePath } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  workProductProviderEnum,
  workProductReviewStateEnum,
  workProductStatusEnum,
  workProductTypeEnum,
  type WorkProductProvider,
  type WorkProductReviewState,
  type WorkProductStatus,
  type WorkProductType,
} from "@shared/contracts";
import type { ReadAll, Transaction } from "./helpers";
import { nowIso } from "./helpers";

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

function listCompanyWorkspaceRoots(
  getDb: () => DatabaseSync,
  companyId: string,
): string[] {
  return (getDb()
    .prepare(
      "SELECT local_path AS localPath FROM workspaces WHERE company_id = ? AND local_path IS NOT NULL ORDER BY is_primary DESC, created_at ASC",
    )
    .all(companyId) as Array<{ localPath: string }>)
    .map((row) => row.localPath)
    .filter((localPath) => localPath.length > 0);
}

function orderedUnique(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function fileExists(targetPath: string): boolean {
  try {
    return statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function joinWorkspaceRelative(root: string, rel: string): string | null {
  if (isAbsolute(rel)) return null;
  const joined = resolvePath(root, rel);
  const within = relativePath(root, joined);
  if (within.startsWith("..") || isAbsolute(within)) return null;
  return joined;
}

function parseWorkProductType(value: string): WorkProductType {
  return workProductTypeEnum.parse(value);
}

function parseWorkProductProvider(value: string): WorkProductProvider {
  return workProductProviderEnum.parse(value);
}

function parseWorkProductStatus(value: string): WorkProductStatus {
  return workProductStatusEnum.parse(value);
}

function parseWorkProductReviewState(value: string): WorkProductReviewState {
  return workProductReviewStateEnum.parse(value);
}

export function buildWorkProductMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  return {
    createWorkProduct(input: {
      companyId: string; taskId: string | null; projectId?: string | null;
      workspaceId?: string | null;
      type: WorkProductType; provider: WorkProductProvider; externalId?: string | null;
      title: string; url?: string | null; status?: WorkProductStatus; reviewState?: WorkProductReviewState;
      isPrimary?: boolean; summary?: string | null; metadataJson?: string | null;
      createdByRunId?: string | null;
    }): string {
      return transaction(() => {
        const id = randomUUID();
        const ts = nowIso();
        const type = parseWorkProductType(input.type);
        const provider = parseWorkProductProvider(input.provider);
        const status = input.status !== undefined ? parseWorkProductStatus(input.status) : "active";
        const reviewState = input.reviewState !== undefined ? parseWorkProductReviewState(input.reviewState) : "none";
        if (input.isPrimary && input.taskId && status !== "archived") {
          getDb().prepare(
            "UPDATE work_products SET is_primary = 0, updated_at = ? WHERE company_id = ? AND task_id = ? AND type = ? AND status <> 'archived'",
          ).run(ts, input.companyId, input.taskId, type);
        }
        getDb().prepare(
          `INSERT INTO work_products (id, company_id, project_id, task_id, workspace_id, type, provider, external_id, title, url, status, review_state, is_primary, summary, metadata_json, created_by_run_id, last_touched_by_run_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, input.companyId, input.projectId ?? null, input.taskId ?? null,
          input.workspaceId ?? null,
          type, provider, input.externalId ?? null,
          input.title, input.url ?? null, status,
          reviewState, input.isPrimary ? 1 : 0,
          input.summary ?? null, input.metadataJson ?? null,
          input.createdByRunId ?? null, input.createdByRunId ?? null, ts, ts,
        );
        return id;
      });
    },

    findWorkProductByExternalId(
      companyId: string,
      provider: WorkProductProvider,
      externalId: string,
      workspaceId: string | null,
    ): { id: string; taskId: string | null } | null {
      const parsedProvider = parseWorkProductProvider(provider);
      if (workspaceId) {
        const row = getDb()
          .prepare(
            "SELECT id, task_id as taskId FROM work_products WHERE company_id = ? AND workspace_id = ? AND provider = ? AND external_id = ? LIMIT 1",
          )
          .get(companyId, workspaceId, parsedProvider, externalId) as
          | { id: string; taskId: string | null }
          | undefined;
        return row ?? null;
      }
      const row = getDb()
        .prepare(
          "SELECT id, task_id as taskId FROM work_products WHERE company_id = ? AND workspace_id IS NULL AND provider = ? AND external_id = ? LIMIT 1",
        )
        .get(companyId, parsedProvider, externalId) as
        | { id: string; taskId: string | null }
        | undefined;
      return row ?? null;
    },

    updateWorkProduct(
      id: string,
      companyId: string,
      patch: {
        type?: WorkProductType;
        provider?: WorkProductProvider;
        externalId?: string | null;
        workspaceId?: string | null;
        title?: string;
        url?: string | null;
        status?: WorkProductStatus;
        reviewState?: WorkProductReviewState;
        isPrimary?: boolean;
        summary?: string | null;
        metadataJson?: string | null;
        lastTouchedByRunId?: string | null;
      },
    ): number {
      return transaction(() => {
        const current = getDb().prepare(
          "SELECT task_id as taskId, type, status, is_primary as isPrimary FROM work_products WHERE id = ? AND company_id = ?",
        ).get(id, companyId) as
          | { taskId: string | null; type: string; status: string; isPrimary: number }
          | undefined;
        if (!current) return 0;

        const ts = nowIso();
        const nextType = patch.type !== undefined ? parseWorkProductType(patch.type) : parseWorkProductType(current.type);
        const nextStatus = patch.status !== undefined ? parseWorkProductStatus(patch.status) : parseWorkProductStatus(current.status);
        const parsedProvider = patch.provider !== undefined ? parseWorkProductProvider(patch.provider) : undefined;
        const parsedReviewState = patch.reviewState !== undefined ? parseWorkProductReviewState(patch.reviewState) : undefined;
        const nextIsPrimary = patch.isPrimary ?? Boolean(current.isPrimary);
        if (nextIsPrimary && current.taskId && nextStatus !== "archived") {
          getDb().prepare(
            "UPDATE work_products SET is_primary = 0, updated_at = ? WHERE company_id = ? AND task_id = ? AND type = ? AND status <> 'archived' AND id <> ?",
          ).run(ts, companyId, current.taskId, nextType, id);
        }

        const sets: string[] = ["updated_at = ?"];
        const values: SQLInputValue[] = [ts];
        const map: Array<[keyof typeof patch, string, (v: unknown) => SQLInputValue]> = [
          ["type", "type", () => nextType],
          ["provider", "provider", () => parsedProvider ?? null],
          ["externalId", "external_id", (v) => (v as string | null) ?? null],
          ["workspaceId", "workspace_id", (v) => (v as string | null) ?? null],
          ["title", "title", (v) => (v as string) ?? null],
          ["url", "url", (v) => (v as string | null) ?? null],
          ["status", "status", () => nextStatus],
          ["reviewState", "review_state", () => parsedReviewState ?? null],
          ["isPrimary", "is_primary", (v) => (v ? 1 : 0)],
          ["summary", "summary", (v) => (v as string | null) ?? null],
          ["metadataJson", "metadata_json", (v) => (v as string | null) ?? null],
          ["lastTouchedByRunId", "last_touched_by_run_id", (v) => (v as string | null) ?? null],
        ];
        for (const [key, col, coerce] of map) {
          if (patch[key] !== undefined) {
            sets.push(`${col} = ?`);
            values.push(coerce(patch[key]));
          }
        }
        values.push(id, companyId);
        const result = getDb()
          .prepare(`UPDATE work_products SET ${sets.join(", ")} WHERE id = ? AND company_id = ?`)
          .run(...values);
        return Number(result.changes ?? 0);
      });
    },

    resolveWorkProductTarget(
      workProductId: string,
      companyId: string,
    ):
      | { kind: "url" | "path"; value: string }
      | { kind: "error"; reason: "not_found" | "archived" | "no_target" | "workspace_unresolved" | "path_escape" | "path_missing"; detail: string } {
      const row = getDb().prepare(
        "SELECT provider, external_id, url, status, task_id, created_by_run_id, last_touched_by_run_id, workspace_id FROM work_products WHERE id = ? AND company_id = ?",
      ).get(workProductId, companyId) as
        | { provider: string; external_id: string | null; url: string | null; status: string; task_id: string | null; created_by_run_id: string | null; last_touched_by_run_id: string | null; workspace_id: string | null }
        | undefined;
      if (!row) return { kind: "error", reason: "not_found", detail: `No work_product row with id=${workProductId}` };
      if (row.status === "archived") return { kind: "error", reason: "archived", detail: "Work product is archived (retirement tombstone)" };

      if (row.url && row.url.length > 0) return { kind: "url", value: row.url };
      if (row.provider !== "filesystem" || !row.external_id) {
        return { kind: "error", reason: "no_target", detail: `provider=${row.provider} external_id=${row.external_id ?? "null"} url=null` };
      }

      const workspaceRoots = orderedUnique([
        resolveWorkspaceRoot(
          getDb,
          companyId,
          row.workspace_id,
          row.task_id,
          row.last_touched_by_run_id ?? row.created_by_run_id,
        ),
        ...listCompanyWorkspaceRoots(getDb, companyId),
      ]);
      let firstCandidate: string | null = null;
      for (const workspaceRoot of workspaceRoots) {
        const absolute = joinWorkspaceRelative(workspaceRoot, row.external_id);
        if (!absolute) {
          return { kind: "error", reason: "path_escape", detail: `external_id=${row.external_id} escapes workspace root ${workspaceRoot}` };
        }
        firstCandidate ??= absolute;
        if (fileExists(absolute)) {
          return { kind: "path", value: absolute };
        }
      }

      if (firstCandidate) {
        return {
          kind: "error",
          reason: "path_missing",
          detail: `No registered company workspace contains ${row.external_id}; first candidate was ${firstCandidate}`,
        };
      }

      return {
        kind: "error",
        reason: "workspace_unresolved",
        detail: `workspace_id=${row.workspace_id ?? "null"} task_id=${row.task_id ?? "null"} run_id=${row.last_touched_by_run_id ?? row.created_by_run_id ?? "null"} — none led to a workspace with a local_path`,
      };
    },

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

    archiveWorkProductsByExternalPaths(input: {
      companyId: string;
      workspaceId: string | null;
      provider: WorkProductProvider;
      paths: string[];
      lastTouchedByRunId: string | null;
    }): Array<{ id: string; externalId: string }> {
      if (input.paths.length === 0) return [];
      const provider = parseWorkProductProvider(input.provider);
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
          provider,
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
  };
}
