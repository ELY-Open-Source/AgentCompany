import log from "electron-log/main.js";
import { z } from "zod";
import { requireParam, type AgentApiServer } from "./server-core";

const createDocumentSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  status: z.string().optional(),
  reviewerAgentId: z.string().optional(),
  projectId: z.string().optional(),
  goalId: z.string().optional(),
  tagsJson: z.string().optional(),
});

const updateDocumentSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  status: z.string().optional(),
  reviewerAgentId: z.union([z.string(), z.null()]).optional(),
  tagsJson: z.string().optional(),
  changeSummary: z.string().optional(),
  baseRevisionId: z.string().optional(),
});

const createWorkProductSchema = z.object({
  type: z.string(),
  provider: z.string(),
  title: z.string(),
  projectId: z.string().optional(),
  externalId: z.string().optional(),
  url: z.string().optional(),
  status: z.string().optional(),
  reviewState: z.string().optional(),
  isPrimary: z.boolean().optional(),
  summary: z.string().optional(),
  metadata: z.unknown().optional(),
});

const updateWorkProductSchema = z.object({
  type: z.string().optional(),
  provider: z.string().optional(),
  externalId: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  status: z.string().optional(),
  reviewState: z.string().optional(),
  isPrimary: z.boolean().optional(),
  summary: z.string().optional(),
  metadataJson: z.string().optional(),
}).strict();

const linkDocumentSchema = z.object({
  documentId: z.string(),
});

export function registerFileRoutes(server: AgentApiServer) {
  const db = server.db;
  const callbacks = server.callbacks;
  const onDomainChanged = server.onDomainChanged;

  server.addRoute("POST", "/api/companies/:companyId/documents", (_req, res, params, token, body) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) { server.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() }); return; }
    const data = parsed.data;
    const reviewerAgentId = data.reviewerAgentId ?? null;
    const projectId = data.projectId ?? null;
    const goalId = data.goalId ?? null;
    if (reviewerAgentId && !db.belongsToCompany("agents", reviewerAgentId, token.companyId)) {
      server.json(res, 400, { error: "Reviewer agent does not belong to the current company" });
      return;
    }
    if (projectId && !db.belongsToCompany("projects", projectId, token.companyId)) {
      server.json(res, 400, { error: "Project does not belong to the current company" });
      return;
    }
    if (goalId && !db.belongsToCompany("goals", goalId, token.companyId)) {
      server.json(res, 400, { error: "Goal does not belong to the current company" });
      return;
    }
    const docType = data.type ?? "knowledge_article";
    const docTitle = data.title ?? "Untitled";
    // Single source of truth for document-creation side effects lives in
    // `document-lifecycle.ts`. Persistence, thread/checkpoint/automation
    // fan-out, reviewer wake, and the deliverable-review gate all fire
    // from inside the pipeline so this HTTP route and the desktop IPC
    // handler stay byte-for-byte consistent.
    const outcome = callbacks.createDocument({
      id: null,
      companyId: token.companyId,
      type: docType,
      title: docTitle,
      content: data.content ?? "",
      authorAgentId: token.agentId,
      reviewerAgentId,
      projectId,
      goalId,
      parentDocId: null,
      version: 1,
      status: data.status ?? "draft",
      tagsJson: data.tagsJson ?? "[]",
      sourceRunId: token.runId ?? null,
    });
    server.json(res, 201, { id: outcome.id });
  });

  server.addRoute("GET", "/api/companies/:companyId/documents", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const docs = db.listDocuments(token.companyId);
    server.json(res, 200, docs);
  });

  server.addRoute("PATCH", "/api/companies/:companyId/documents/:documentId", (_req, res, params, token, body) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const documentId = params.documentId;
    if (!documentId) {
      server.json(res, 400, { error: "Missing documentId" });
      return;
    }
    const doc = db.getDocumentForUpdate(documentId, token.companyId);
    if (!doc) {
      server.json(res, 404, { error: "Document not found in this company" });
      return;
    }
    const parsed = updateDocumentSchema.safeParse(body);
    if (!parsed.success) { server.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() }); return; }
    const data = parsed.data;
    const VALID_STATUSES = new Set(["draft", "in_review", "approved", "archived", "superseded"]);
    const reviewerAgentId = data.reviewerAgentId !== undefined
      ? (data.reviewerAgentId ?? null)
      : doc.reviewerAgentId;
    if (data.reviewerAgentId !== undefined && reviewerAgentId && !db.belongsToCompany("agents", reviewerAgentId, token.companyId)) {
      server.json(res, 400, { error: "Reviewer agent does not belong to the current company" });
      return;
    }

    // Conflict detection: if baseRevisionId provided, verify it matches current
    if (data.baseRevisionId !== undefined) {
      const currentRevId = db.getDocumentLatestRevisionId(documentId);
      if (currentRevId && data.baseRevisionId !== currentRevId) {
        server.json(res, 409, { error: "Document was updated by someone else", currentRevisionId: currentRevId });
        return;
      }
    }

    if (data.status !== undefined) {
      if (!VALID_STATUSES.has(data.status)) {
        server.json(res, 400, { error: `Invalid status "${data.status}". Must be one of: ${[...VALID_STATUSES].join(", ")}` });
        return;
      }
    }

    // Content update → create revision for audit trail
    let updatedVersion = doc.version;
    if (data.content !== undefined) {
      const revision = db.createDocumentRevision({
        documentId,
        companyId: token.companyId,
        body: data.content,
        changeSummary: data.changeSummary ?? null,
        createdByAgentId: token.agentId ?? null,
      });
      updatedVersion = revision.revisionNumber;
    }

    // Field updates (title, reviewer, tags, etc.)
    if (data.status !== undefined) {
      db.updateDocumentStatus(documentId, token.companyId, data.status);
    }
    db.saveDocument({
      id: documentId,
      companyId: token.companyId,
      type: data.type ?? doc.type,
      title: data.title ?? doc.title,
      content: data.content ?? doc.content,
      authorAgentId: doc.authorAgentId,
      reviewerAgentId,
      projectId: doc.projectId,
      goalId: doc.goalId,
      version: updatedVersion,
      status: data.status ?? doc.status,
      tagsJson: data.tagsJson ?? doc.tagsJson,
      sourceRunId: data.content !== undefined ? (token.runId ?? null) : null,
    });

    onDomainChanged();
    server.json(res, 200, { updated: true, latestRevisionId: db.getDocumentLatestRevisionId(documentId) });
  });

  server.addRoute("GET", "/api/companies/:companyId/documents/:documentId/revisions", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) { server.json(res, 403, { error: "Company mismatch" }); return; }
    const documentId = params.documentId;
    if (!documentId) { server.json(res, 400, { error: "Missing documentId" }); return; }
    const revisions = db.listDocumentRevisions(documentId, token.companyId);
    server.json(res, 200, revisions);
  });

  // ── Work Products ──

  server.addRoute("GET", "/api/issues/:issueId/work-products", (_req, res, params, token) => {
    try {
      const task = db.getTask(requireParam(params, "issueId"));
      if (task.companyId !== token.companyId) { server.json(res, 404, { error: "Task not found" }); return; }
      const products = db.listWorkProductsForTask(task.id, task.companyId);
      server.json(res, 200, products);
    } catch (error) {
      log.warn(`[api/work-products] list failed for issue ${params.issueId}: ${error instanceof Error ? error.message : String(error)}`);
      server.json(res, 404, { error: "Task not found" });
    }
  });

  server.addRoute("POST", "/api/issues/:issueId/work-products", (_req, res, params, token, body) => {
    try {
      const task = db.getTask(requireParam(params, "issueId"));
      if (task.companyId !== token.companyId) { server.json(res, 404, { error: "Task not found" }); return; }
      const parsed = createWorkProductSchema.safeParse(body);
      if (!parsed.success) { server.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() }); return; }
      const data = parsed.data;
      const id = db.createWorkProduct({
        companyId: task.companyId,
        taskId: task.id,
        projectId: data.projectId ?? task.projectId,
        workspaceId: task.workspaceId ?? null,
        type: data.type,
        provider: data.provider,
        externalId: data.externalId ?? null,
        title: data.title,
        url: data.url ?? null,
        status: data.status ?? "active",
        reviewState: data.reviewState ?? "none",
        isPrimary: data.isPrimary === true,
        summary: data.summary ?? null,
        metadataJson: data.metadata ? JSON.stringify(data.metadata) : null,
        createdByRunId: token.runId ?? null,
      });
      onDomainChanged();
      server.json(res, 201, { id });
    } catch (error) {
      log.warn(`[api/work-products] create failed for issue ${params.issueId}: ${error instanceof Error ? error.message : String(error)}`);
      server.json(res, 404, { error: "Task not found" });
    }
  });

  server.addRoute("PATCH", "/api/work-products/:workProductId", (_req, res, params, token, body) => {
    const wpId = params.workProductId;
    if (!wpId) { server.json(res, 400, { error: "Missing workProductId" }); return; }
    const parsed = updateWorkProductSchema.safeParse(body);
    if (!parsed.success) { server.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() }); return; }
    const changes = db.updateWorkProduct(wpId, token.companyId, parsed.data);
    if (changes === 0) { server.json(res, 404, { error: "Work product not found" }); return; }
    onDomainChanged();
    server.json(res, 200, { updated: true });
  });

  server.addRoute("DELETE", "/api/work-products/:workProductId", (_req, res, params, token) => {
    const wpId = params.workProductId;
    if (!wpId) { server.json(res, 400, { error: "Missing workProductId" }); return; }
    const changes = db.deleteWorkProduct(wpId, token.companyId);
    if (changes === 0) { server.json(res, 404, { error: "Work product not found" }); return; }
    onDomainChanged();
    server.json(res, 200, { deleted: true });
  });

  // ── Task-Document Links ──

  server.addRoute("GET", "/api/issues/:issueId/documents", (_req, res, params, token) => {
    try {
      const task = db.getTask(requireParam(params, "issueId"));
      if (task.companyId !== token.companyId) { server.json(res, 404, { error: "Task not found" }); return; }
      const links = db.listDocumentsForTask(task.id, task.companyId);
      server.json(res, 200, links);
    } catch (error) {
      log.warn(`[api/task-documents] list failed for issue ${params.issueId}: ${error instanceof Error ? error.message : String(error)}`);
      server.json(res, 404, { error: "Task not found" });
    }
  });

  server.addRoute("PUT", "/api/issues/:issueId/documents/:key", (_req, res, params, token, body) => {
    try {
      const task = db.getTask(requireParam(params, "issueId"));
      if (task.companyId !== token.companyId) { server.json(res, 404, { error: "Task not found" }); return; }
      const key = String(params.key ?? "").trim().toLowerCase();
      if (!key || !/^[a-z0-9][a-z0-9_-]*$/.test(key) || key.length > 64) {
        server.json(res, 400, { error: "Invalid document key. Must be lowercase alphanumeric with _ or -, 1-64 chars." }); return;
      }
      const parsed = linkDocumentSchema.safeParse(body);
      if (!parsed.success) { server.json(res, 400, { error: "Invalid input", details: parsed.error.flatten() }); return; }
      const documentId = parsed.data.documentId;
      if (!db.belongsToCompany("documents", documentId, token.companyId)) {
        server.json(res, 400, { error: "Document does not belong to this company" }); return;
      }
      const linkId = db.linkDocumentToTask(task.id, documentId, task.companyId, key);
      onDomainChanged();
      server.json(res, 200, { id: linkId, key });
    } catch (error) {
      log.warn(`[api/task-documents] link failed for issue ${params.issueId}: ${error instanceof Error ? error.message : String(error)}`);
      server.json(res, 404, { error: "Task not found" });
    }
  });

  server.addRoute("DELETE", "/api/issues/:issueId/documents/:key", (_req, res, params, token) => {
    try {
      const task = db.getTask(requireParam(params, "issueId"));
      if (task.companyId !== token.companyId) { server.json(res, 404, { error: "Task not found" }); return; }
      const key = String(params.key ?? "").trim().toLowerCase();
      db.unlinkDocumentFromTask(task.id, key, task.companyId);
      onDomainChanged();
      server.json(res, 200, { unlinked: true });
    } catch (error) {
      log.warn(`[api/task-documents] unlink failed for issue ${params.issueId}: ${error instanceof Error ? error.message : String(error)}`);
      server.json(res, 404, { error: "Task not found" });
    }
  });
}
