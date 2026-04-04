import type { AgentApiServer } from "./server-core";

export function registerFileRoutes(server: AgentApiServer) {
  const db = server.db_;
  const callbacks = server.callbacks_;
  const onDomainChanged = server.onDomainChanged_;
  const onWakeAgent = server.onWakeAgent_;

  server.addRoute("POST", "/api/companies/:companyId/documents", (_req, res, params, token, body) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const data = body as Record<string, unknown>;
    const reviewerAgentId = data.reviewerAgentId ? String(data.reviewerAgentId) : null;
    const projectId = data.projectId ? String(data.projectId) : null;
    const goalId = data.goalId ? String(data.goalId) : null;
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
    const docType = String(data.type ?? "knowledge_article");
    const docTitle = String(data.title ?? "Untitled");
    const id = db.saveDocument({
      companyId: token.companyId,
      type: docType,
      title: docTitle,
      content: String(data.content ?? ""),
      authorAgentId: token.agentId,
      reviewerAgentId,
      projectId,
      goalId,
      status: String(data.status ?? "draft"),
      tagsJson: data.tagsJson ? String(data.tagsJson) : "[]",
      sourceRunId: token.runId ?? null,
    });
    onDomainChanged();
    // Derive taskId from the agent's current run so thread integration
    // and checkpoint engine can bind the document to its originating task.
    let taskId: string | null = null;
    if (token.runId) {
      try {
        const run = db.getRun(token.runId);
        if (run.companyId === token.companyId) {
          taskId = run.taskId;
        }
      } catch { /* run may have finished or been deleted */ }
    }
    // Fire document creation automation rules
    callbacks.onDocumentCreated(token.companyId, token.agentId, projectId, id, docTitle, docType, taskId);
    // Wake document reviewer if specified
    if (reviewerAgentId) {
      onWakeAgent(reviewerAgentId, token.companyId, "assignment");
    }

    // Deliverable review gate: check at document creation time (most reliable).
    // In ai_cofounder mode, checkpoint-engine handles document reviews via the
    // onDocumentCreated callback, so skip the direct approval here to avoid duplicates.
    const IMPORTANT_DOC_TYPES = new Set(["prd","technical_spec","design_doc","project_brief","proposal","budget_proposal","architecture_decision","contract","sop"]);
    if (IMPORTANT_DOC_TYPES.has(docType)) {
      try {
        const company = db.listSnapshot().companies.find((c) => c.id === token.companyId);
        const isCofounderMode = db.getCompanyExecutionMode(token.companyId) === "ai_cofounder";

        if (company?.reviewDeliverables && !isCofounderMode) {
          if (!db.hasPendingDeliverableReviews(token.companyId)) {
            db.requestApproval({
              companyId: token.companyId,
              relatedTaskId: taskId,
              requestedByAgentId: token.agentId,
              type: "deliverable_review",
              payloadSummary: `Review deliverable: ${docTitle}`.slice(0, 280),
              impactSummary: `New ${docType.replaceAll("_", " ")} created. Awaiting your review before workflow continues.`.slice(0, 400),
              payloadJson: JSON.stringify({ documentIds: [id], documents: [{ id, type: docType, title: docTitle }] }),
            });
            try {
              const agent = db.getAgent(token.agentId);
              if (agent.heartbeatEnabled) {
                db.setHeartbeat(token.agentId, false, agent.heartbeatIntervalSec || 120);
              }
            } catch { /* best effort */ }
            onDomainChanged();
          }
        }
      } catch { /* deliverable review gate is best-effort */ }
    }

    server.json(res, 201, { id });
  });

  server.addRoute("GET", "/api/companies/:companyId/documents", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const snapshot = db.listSnapshot();
    const docs = snapshot.documents.filter(d => d.companyId === token.companyId);
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
    const snapshot = db.listSnapshot();
    const doc = snapshot.documents.find(d => d.id === documentId && d.companyId === token.companyId);
    if (!doc) {
      server.json(res, 404, { error: "Document not found in this company" });
      return;
    }
    const data = body as Record<string, unknown>;
    const VALID_STATUSES = new Set(["draft", "in_review", "approved", "archived", "superseded"]);
    const reviewerAgentId = data.reviewerAgentId !== undefined
      ? (data.reviewerAgentId ? String(data.reviewerAgentId) : null)
      : doc.reviewerAgentId;
    if (data.reviewerAgentId !== undefined && reviewerAgentId && !db.belongsToCompany("agents", reviewerAgentId, token.companyId)) {
      server.json(res, 400, { error: "Reviewer agent does not belong to the current company" });
      return;
    }

    // Conflict detection: if baseRevisionId provided, verify it matches current
    if (typeof data.baseRevisionId === "string") {
      const currentRevId = db.getDocumentLatestRevisionId(documentId);
      if (currentRevId && data.baseRevisionId !== currentRevId) {
        server.json(res, 409, { error: "Document was updated by someone else", currentRevisionId: currentRevId });
        return;
      }
    }

    if (data.status !== undefined) {
      const newStatus = String(data.status);
      if (!VALID_STATUSES.has(newStatus)) {
        server.json(res, 400, { error: `Invalid status "${newStatus}". Must be one of: ${[...VALID_STATUSES].join(", ")}` });
        return;
      }
    }

    // Content update → create revision for audit trail
    let updatedVersion = doc.version;
    if (data.content !== undefined) {
      const newContent = String(data.content);
      const revision = db.createDocumentRevision({
        documentId,
        companyId: token.companyId,
        body: newContent,
        changeSummary: typeof data.changeSummary === "string" ? data.changeSummary : null,
        createdByAgentId: token.agentId ?? null,
      });
      updatedVersion = revision.revisionNumber;
    }

    // Field updates (title, reviewer, tags, etc.)
    if (data.status !== undefined) {
      db.updateDocumentStatus(documentId, token.companyId, String(data.status));
    }
    db.saveDocument({
      id: documentId,
      companyId: token.companyId,
      type: data.type ? String(data.type) : doc.type,
      title: data.title ? String(data.title) : doc.title,
      content: data.content !== undefined ? String(data.content) : doc.content,
      authorAgentId: doc.authorAgentId,
      reviewerAgentId,
      projectId: doc.projectId,
      goalId: doc.goalId,
      version: updatedVersion,
      status: data.status ? String(data.status) : doc.status,
      tagsJson: data.tagsJson ? String(data.tagsJson) : doc.tagsJson,
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
      const task = db.getTask(params.issueId!);
      if (task.companyId !== token.companyId) { server.json(res, 404, { error: "Task not found" }); return; }
      const products = db.listWorkProductsForTask(task.id, task.companyId);
      server.json(res, 200, products);
    } catch { server.json(res, 404, { error: "Task not found" }); }
  });

  server.addRoute("POST", "/api/issues/:issueId/work-products", (_req, res, params, token, body) => {
    try {
      const task = db.getTask(params.issueId!);
      if (task.companyId !== token.companyId) { server.json(res, 404, { error: "Task not found" }); return; }
      const data = body as Record<string, unknown>;
      if (!data.type || !data.provider || !data.title) {
        server.json(res, 400, { error: "type, provider, and title are required" }); return;
      }
      const id = db.createWorkProduct({
        companyId: task.companyId,
        taskId: task.id,
        projectId: typeof data.projectId === "string" ? data.projectId : task.projectId,
        type: String(data.type),
        provider: String(data.provider),
        externalId: typeof data.externalId === "string" ? data.externalId : null,
        title: String(data.title),
        url: typeof data.url === "string" ? data.url : null,
        status: typeof data.status === "string" ? data.status : "active",
        reviewState: typeof data.reviewState === "string" ? data.reviewState : "none",
        isPrimary: data.isPrimary === true,
        summary: typeof data.summary === "string" ? data.summary : null,
        metadataJson: data.metadata ? JSON.stringify(data.metadata) : null,
        createdByRunId: token.runId ?? null,
      });
      onDomainChanged();
      server.json(res, 201, { id });
    } catch { server.json(res, 404, { error: "Task not found" }); }
  });

  server.addRoute("PATCH", "/api/work-products/:workProductId", (_req, res, params, token, body) => {
    const wpId = params.workProductId;
    if (!wpId) { server.json(res, 400, { error: "Missing workProductId" }); return; }
    const data = body as Record<string, unknown>;
    db.updateWorkProduct(wpId, token.companyId, data);
    onDomainChanged();
    server.json(res, 200, { updated: true });
  });

  server.addRoute("DELETE", "/api/work-products/:workProductId", (_req, res, params, token) => {
    const wpId = params.workProductId;
    if (!wpId) { server.json(res, 400, { error: "Missing workProductId" }); return; }
    db.deleteWorkProduct(wpId, token.companyId);
    onDomainChanged();
    server.json(res, 200, { deleted: true });
  });

  // ── Task-Document Links ──

  server.addRoute("GET", "/api/issues/:issueId/documents", (_req, res, params, token) => {
    try {
      const task = db.getTask(params.issueId!);
      if (task.companyId !== token.companyId) { server.json(res, 404, { error: "Task not found" }); return; }
      const links = db.listDocumentsForTask(task.id, task.companyId);
      server.json(res, 200, links);
    } catch { server.json(res, 404, { error: "Task not found" }); }
  });

  server.addRoute("PUT", "/api/issues/:issueId/documents/:key", (_req, res, params, token, body) => {
    try {
      const task = db.getTask(params.issueId!);
      if (task.companyId !== token.companyId) { server.json(res, 404, { error: "Task not found" }); return; }
      const key = String(params.key ?? "").trim().toLowerCase();
      if (!key || !/^[a-z0-9][a-z0-9_-]*$/.test(key) || key.length > 64) {
        server.json(res, 400, { error: "Invalid document key. Must be lowercase alphanumeric with _ or -, 1-64 chars." }); return;
      }
      const data = body as Record<string, unknown>;
      const documentId = typeof data.documentId === "string" ? data.documentId : null;
      if (!documentId) { server.json(res, 400, { error: "documentId is required" }); return; }
      if (!db.belongsToCompany("documents", documentId, token.companyId)) {
        server.json(res, 400, { error: "Document does not belong to this company" }); return;
      }
      const linkId = db.linkDocumentToTask(task.id, documentId, task.companyId, key);
      onDomainChanged();
      server.json(res, 200, { id: linkId, key });
    } catch { server.json(res, 404, { error: "Task not found" }); }
  });

  server.addRoute("DELETE", "/api/issues/:issueId/documents/:key", (_req, res, params, token) => {
    try {
      const task = db.getTask(params.issueId!);
      if (task.companyId !== token.companyId) { server.json(res, 404, { error: "Task not found" }); return; }
      const key = String(params.key ?? "").trim().toLowerCase();
      db.unlinkDocumentFromTask(task.id, key, task.companyId);
      onDomainChanged();
      server.json(res, 200, { unlinked: true });
    } catch { server.json(res, 404, { error: "Task not found" }); }
  });
}
