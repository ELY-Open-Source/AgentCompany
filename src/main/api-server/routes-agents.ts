import log from "electron-log/main.js";
import { hireRequestSchema } from "@shared/contracts";
import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import { canManageOrganization, canRequestHire } from "../agent-permissions";
import { resolveApprovalDecision, shouldAutoApproveApproval } from "../approval-policy";
import type { AgentApiServer } from "./server-core";

export function registerAgentRoutes(server: AgentApiServer) {
  const db = server.db_;
  const callbacks = server.callbacks_;
  const onDomainChanged = server.onDomainChanged_;
  server.addRoute("GET", "/api/agents/me", (_req, res, _params, token) => {
    const agent = db.getAgent(token.agentId);
    const chainOfCommand = db.getChainOfCommand(token.agentId);
    const directReports = db.getDirectReports(token.agentId, token.companyId);
    server.json(res, 200, { agent, chainOfCommand, directReports });
  });

  server.addRoute("GET", "/api/agents/me/standup", (_req, res, _params, token) => {
    const snapshot = db.listSnapshot();
    const agent = snapshot.agents.find((a) => a.id === token.agentId);
    if (!agent) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }

    const myTasks = snapshot.tasks.filter((t) => t.assigneeAgentId === token.agentId && t.companyId === token.companyId);
    const directReports = snapshot.agents.filter((a) => a.reportsTo === token.agentId && a.companyId === token.companyId);
    const reportIds = new Set(directReports.map((a) => a.id));
    const reportTasks = snapshot.tasks.filter((t) => t.assigneeAgentId && reportIds.has(t.assigneeAgentId) && t.companyId === token.companyId);

    const tasksAwaitingMyReview = reportTasks.filter((t) => t.status === "in_review");
    const blockedReportTasks = reportTasks.filter((t) => t.status === "blocked");
    const myBlockedTasks = myTasks.filter((t) => t.status === "blocked");
    const myInProgressTasks = myTasks.filter((t) => t.status === "in_progress");
    const myTodoTasks = myTasks.filter((t) => t.status === "todo");

    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const recentComments = snapshot.comments
      .filter((c) => {
        const isMyTask = myTasks.some((t) => t.id === c.taskId);
        const isReportTask = reportTasks.some((t) => t.id === c.taskId);
        return (isMyTask || isReportTask) && new Date(c.createdAt).getTime() > twoHoursAgo;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);

    const myPendingApprovals = snapshot.approvals.filter(
      (a) => a.requestedByAgentId === token.agentId && a.state === "pending" && a.companyId === token.companyId,
    );
    const myResolvedApprovals = snapshot.approvals.filter(
      (a) => a.requestedByAgentId === token.agentId && a.state !== "pending" && a.companyId === token.companyId,
    ).slice(0, 5);

    server.json(res, 200, {
      agent: { id: agent.id, name: agent.name, role: agent.role, status: agent.status },
      summary: {
        tasksAwaitingReview: tasksAwaitingMyReview.length,
        blockedReportTasks: blockedReportTasks.length,
        myBlockedTasks: myBlockedTasks.length,
        myInProgress: myInProgressTasks.length,
        myTodo: myTodoTasks.length,
        pendingApprovals: myPendingApprovals.length,
        directReports: directReports.length,
      },
      tasksAwaitingReview: tasksAwaitingMyReview.map((t) => ({
        id: t.id,
        title: t.title,
        assignee: snapshot.agents.find((a) => a.id === t.assigneeAgentId)?.name ?? "Unknown",
        priority: t.priority,
      })),
      blockedTasks: [...blockedReportTasks, ...myBlockedTasks].map((t) => ({
        id: t.id,
        title: t.title,
        assignee: snapshot.agents.find((a) => a.id === t.assigneeAgentId)?.name ?? "Unknown",
        priority: t.priority,
      })),
      recentComments: recentComments.map((c) => ({
        taskId: c.taskId,
        taskTitle: snapshot.tasks.find((t) => t.id === c.taskId)?.title ?? "",
        author: c.authorName,
        body: c.body.slice(0, 200),
        createdAt: c.createdAt,
      })),
      pendingApprovals: myPendingApprovals.map((a) => ({
        id: a.id,
        type: a.type,
        summary: a.payloadSummary,
        state: a.state,
      })),
      resolvedApprovals: myResolvedApprovals.map((a) => ({
        id: a.id,
        type: a.type,
        summary: a.payloadSummary,
        state: a.state,
        decisionNote: a.decisionNote,
      })),
      reportStatuses: directReports.map((r) => {
        const rTasks = snapshot.tasks.filter((t) => t.assigneeAgentId === r.id && t.companyId === token.companyId);
        return {
          id: r.id,
          name: r.name,
          role: r.role,
          status: r.status,
          tasksInProgress: rTasks.filter((t) => t.status === "in_progress").length,
          tasksInReview: rTasks.filter((t) => t.status === "in_review").length,
          tasksBlocked: rTasks.filter((t) => t.status === "blocked").length,
          tasksDone: rTasks.filter((t) => t.status === "done").length,
        };
      }),
      socialAccounts: snapshot.socialAccounts
        .filter((a) => a.companyId === token.companyId)
        .map((a) => ({
          id: a.id,
          platform: a.platform,
          accountName: a.accountName,
          displayName: a.displayName,
          status: a.status,
          requireApproval: a.requireApproval,
        })),
    });
  });

  server.addRoute("GET", "/api/agents/me/metrics", (_req, res, _params, token) => {
    const companyMetrics = db.getCompanyMetrics(token.companyId, 30);
    const agentMetric = companyMetrics.agentMetrics.find(m => m.agentId === token.agentId);
    if (!agentMetric) {
      server.json(res, 404, { error: "Metrics not found" });
      return;
    }
    server.json(res, 200, agentMetric);
  });

  server.addRoute("GET", "/api/agents/:agentId/metrics", (_req, res, params, token) => {
    const snapshot = db.listSnapshot();
    const agent = snapshot.agents.find((entry) => entry.id === params.agentId && entry.companyId === token.companyId);
    if (!agent) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }
    const companyMetrics = db.getCompanyMetrics(token.companyId, 30);
    const agentMetric = companyMetrics.agentMetrics.find((metric) => metric.agentId === params.agentId);
    if (!agentMetric) {
      server.json(res, 404, { error: "Metrics not found" });
      return;
    }
    server.json(res, 200, agentMetric);
  });

  server.addRoute("GET", "/api/agents/:agentId", (_req, res, params, token) => {
    const snapshot = db.listSnapshot();
    const agent = snapshot.agents.find(a => a.id === params.agentId && a.companyId === token.companyId);
    if (!agent) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }
    const directReports = snapshot.agents.filter(a => a.reportsTo === agent.id && a.companyId === token.companyId);
    const manager = agent.reportsTo ? snapshot.agents.find(a => a.id === agent.reportsTo) : null;
    server.json(res, 200, {
      ...agent,
      manager: manager ? { id: manager.id, name: manager.name, role: manager.role } : null,
      directReports: directReports.map(r => ({ id: r.id, name: r.name, role: r.role, status: r.status })),
    });
  });

  server.addRoute("GET", "/api/companies/:companyId/agents", (_req, res, params, token) => {
    if (params.companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    const snapshot = db.listSnapshot();
    const agents = snapshot.agents.filter((a) => a.companyId === params.companyId);
    server.json(res, 200, agents);
  });

  server.addRoute("POST", "/api/companies/:companyId/agents", (_req, res, params, token, body) => {
    const companyId = params.companyId!;
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    if (!canRequestHire(db, companyId, token.agentId)) {
      server.json(res, 403, { error: "Current agent is not allowed to request hires" });
      return;
    }
    const parsed = hireRequestSchema.safeParse({
      companyId,
      requestedByAgentId: token.agentId,
      ...(typeof body === "object" && body ? body : {}),
      reportsTo:
        typeof body === "object" && body && "reportsTo" in body
          ? (body as { reportsTo?: string | null }).reportsTo
          : token.agentId,
    });
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid hire payload" });
      return;
    }
    const input = parsed.data;
    if (server.companyRefError(res, companyId, [
      { id: input.requestedByAgentId, table: "agents", label: "requesting agent" },
      { id: input.reportsTo, table: "agents", label: "manager" },
      { id: input.workspaceId, table: "workspaces", label: "workspace" },
    ])) {
      return;
    }
    if (
      input.reportsTo &&
      input.reportsTo !== token.agentId &&
      !canManageOrganization(db, companyId, token.agentId) &&
      !db.getChainOfCommand(input.reportsTo).some((agent) => agent.id === token.agentId)
    ) {
      server.json(res, 403, { error: "Requested hire must report to you or a manager in your reporting chain." });
      return;
    }
    const connectorRecord = (() => {
      try {
        return db.getConnector(input.connectorId);
      } catch {
        return null;
      }
    })();
    if (!connectorRecord) {
      server.json(res, 422, { error: "The selected connector does not exist." });
      return;
    }
    const connectorIssue = getConnectorExecutionReadinessIssue(connectorRecord);
    if (connectorIssue) {
      server.json(res, 422, { error: connectorIssue });
      return;
    }

    // Prevent duplicate agents: reject if a non-terminated agent with the same name already exists
    const existingAgents = db.listSnapshot().agents.filter(
      (a) => a.companyId === companyId && a.status !== "terminated",
    );
    const duplicateByName = existingAgents.find(
      (a) => a.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (duplicateByName) {
      server.json(res, 409, { error: `Agent "${input.name}" already exists in this company (id: ${duplicateByName.id}, role: ${duplicateByName.role}). Use the existing agent instead of creating a duplicate.` });
      return;
    }
    // Also check pending hire approvals with the same name to prevent concurrent duplicate requests
    const pendingHires = db.listSnapshot().approvals.filter(
      (a) => a.companyId === companyId && a.type === "hire_agent" && a.state === "pending",
    );
    for (const pending of pendingHires) {
      try {
        const payload = pending.payloadJson ? JSON.parse(pending.payloadJson) as Record<string, unknown> : {};
        if (typeof payload.name === "string" && payload.name.toLowerCase() === input.name.toLowerCase()) {
          server.json(res, 409, { error: `A hire request for "${input.name}" is already pending approval.` });
          return;
        }
      } catch { /* invalid payloadJson, skip */ }
    }

    const managerLabel = input.reportsTo
      ? (() => {
        try {
          return db.getAgent(input.reportsTo).name;
        } catch {
          return input.reportsTo;
        }
      })()
      : "the company board";

    let result: { agentId: string; approvalId: string };
    try {
      result = db.createHireRequest({
        companyId,
        requestedByAgentId: input.requestedByAgentId ?? token.agentId,
        name: input.name,
        role: input.role,
        title: input.title,
        department: input.department ?? null,
        reportsTo: input.reportsTo ?? token.agentId,
        connectorId: input.connectorId,
        workspaceId: input.workspaceId ?? null,
        model: input.model ?? null,
        metadataJson: input.metadataJson ?? "{}",
        capabilities: input.capabilities,
        budgetMonthlyUsd: input.budgetMonthlyUsd,
        payloadSummary: `Hire ${input.name} as ${input.role}`,
        impactSummary: input.capabilities || `${input.name} will report to ${managerLabel}.`,
        payloadJson: JSON.stringify({
          requestedByAgentId: input.requestedByAgentId ?? token.agentId,
          requestedConfigurationSnapshot: {
            connectorId: input.connectorId,
            workspaceId: input.workspaceId ?? null,
            model: input.model ?? null,
            metadataJson: input.metadataJson ?? "{}",
            capabilities: input.capabilities,
            budgetMonthlyUsd: input.budgetMonthlyUsd,
            reportsTo: input.reportsTo ?? token.agentId,
            department: input.department ?? null,
            title: input.title,
          },
        }),
      });
    } catch (error) {
      server.json(res, 422, { error: error instanceof Error ? error.message : "Hire could not be created" });
      return;
    }

    db.addActivity({
      companyId,
      actor: token.agentId,
      action: "agent.hire_requested",
      entityType: "agent",
      entityId: result.agentId,
      detail: input.name,
    });

    let autoApproved = false;
    if (shouldAutoApproveApproval(db, companyId, "hire_agent")) {
      resolveApprovalDecision({
        db,
        handleApprovalResolved: callbacks.onApprovalResolved,
        companyId,
        approvalId: result.approvalId,
        state: "approved",
        decisionNote: "Auto-approved by company policy",
        detail: `Auto-approved hire: ${input.name}`,
      });
      autoApproved = true;
      log.info(`[auto-approve] Auto-approved hire of ${input.name} via agent API`);
    }

    onDomainChanged();
    server.json(res, 201, { ...result, autoApproved });
  });

}
