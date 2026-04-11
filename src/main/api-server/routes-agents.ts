import log from "electron-log/main.js";
import { hireRequestSchema } from "@shared/contracts";
import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import {
  canManageOrganization,
  canRequestHire,
  getHireNameValidationError,
  getHireRoutingValidationError,
  resolveHireReportsTo,
} from "../agent-permissions";
import { resolveApprovalDecision, shouldAutoApproveApproval } from "../approval-policy";
import { requireParam, type AgentApiServer } from "./server-core";

type AgentStandupRow = {
  id: string; companyId: string; name: string; role: string;
  status: string; reportsTo: string | null; department: string | null;
};

type TaskStandupRow = {
  id: string; companyId: string; title: string;
  assigneeAgentId: string | null; status: string; priority: string;
};

type ApprovalStandupRow = {
  id: string; companyId: string; type: string;
  requestedByAgentId: string; state: string;
  payloadSummary: string | null; decisionNote: string | null;
};

type TaskCommentRow = {
  id: string; taskId: string; authorName: string;
  body: string; createdAt: string;
};

type AgentListRow = {
  id: string; companyId: string; name: string; role: string;
  title: string | null; department: string | null; status: string;
  reportsTo: string | null; connectorId: string; workspaceId: string | null;
  model: string | null; capabilities: string | null;
  budgetMonthlyUsd: number | null; spentMonthlyUsd: number | null;
  metadataJson: string; heartbeatEnabled: number;
  heartbeatIntervalSec: number | null; lastHeartbeatAt: string | null;
  createdAt: string; updatedAt: string;
};

export function registerAgentRoutes(server: AgentApiServer) {
  const db = server.db;
  const callbacks = server.callbacks;
  const onDomainChanged = server.onDomainChanged;
  server.addRoute("GET", "/api/agents/me", (_req, res, _params, token) => {
    const agent = db.getAgent(token.agentId);
    const chainOfCommand = db.getChainOfCommand(token.agentId);
    const directReports = db.getDirectReports(token.agentId, token.companyId);
    server.json(res, 200, { agent, chainOfCommand, directReports });
  });

  server.addRoute("GET", "/api/agents/me/standup", (_req, res, _params, token) => {
    const agent = db.getAgent(token.agentId);
    if (!agent || agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }

    const companyAgents = db.queryAll<AgentStandupRow>(
      "select id, company_id as companyId, name, role, status, reports_to as reportsTo, department from agents where company_id = ? order by created_at asc",
      token.companyId,
    );
    const companyTasks = db.queryAll<TaskStandupRow>(
      "select id, company_id as companyId, title, assignee_agent_id as assigneeAgentId, status, priority from tasks where company_id = ? order by created_at desc",
      token.companyId,
    );
    const companyApprovals = db.queryAll<ApprovalStandupRow>(
      "select id, company_id as companyId, type, requested_by_agent_id as requestedByAgentId, state, payload_summary as payloadSummary, decision_note as decisionNote from approvals where company_id = ? order by created_at desc",
      token.companyId,
    );

    const myTasks = companyTasks.filter((t) => t.assigneeAgentId === token.agentId);
    const directReports = companyAgents.filter((a) => a.reportsTo === token.agentId);
    const reportIds = new Set(directReports.map((a) => a.id));
    const reportTasks = companyTasks.filter((t) => t.assigneeAgentId && reportIds.has(t.assigneeAgentId));

    const tasksAwaitingMyReview = reportTasks.filter((t) => t.status === "in_review");
    const blockedReportTasks = reportTasks.filter((t) => t.status === "blocked");
    const myBlockedTasks = myTasks.filter((t) => t.status === "blocked");
    const myInProgressTasks = myTasks.filter((t) => t.status === "in_progress");
    const myTodoTasks = myTasks.filter((t) => t.status === "todo");

    const allRelevantTaskIds = new Set([...myTasks.map((t) => t.id), ...reportTasks.map((t) => t.id)]);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const recentComments = allRelevantTaskIds.size > 0
      ? db.queryAll<TaskCommentRow>(
          `select id, task_id as taskId, author_name as authorName, body, created_at as createdAt from task_comments where task_id in (${[...allRelevantTaskIds].map(() => "?").join(",")}) and created_at > ? order by created_at desc limit 20`,
          ...[...allRelevantTaskIds], twoHoursAgo,
        )
      : [];

    const myPendingApprovals = companyApprovals.filter(
      (a) => a.requestedByAgentId === token.agentId && a.state === "pending",
    );
    const myResolvedApprovals = companyApprovals.filter(
      (a) => a.requestedByAgentId === token.agentId && a.state !== "pending",
    ).slice(0, 5);

    const agentNameMap = new Map(companyAgents.map((a) => [a.id, a.name]));
    const taskTitleMap = new Map(companyTasks.map((t) => [t.id, t.title]));
    const socialAccounts = db.listSocialAccounts(token.companyId);

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
        assignee: agentNameMap.get(t.assigneeAgentId ?? "") ?? "Unknown",
        priority: t.priority,
      })),
      blockedTasks: [...blockedReportTasks, ...myBlockedTasks].map((t) => ({
        id: t.id,
        title: t.title,
        assignee: agentNameMap.get(t.assigneeAgentId ?? "") ?? "Unknown",
        priority: t.priority,
      })),
      recentComments: recentComments.map((c) => ({
        taskId: c.taskId,
        taskTitle: taskTitleMap.get(c.taskId) ?? "",
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
        const rTasks = companyTasks.filter((t) => t.assigneeAgentId === r.id);
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
      socialAccounts: socialAccounts.map((a) => ({
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
    const agentId = requireParam(params, "agentId");
    const agent = db.getAgent(agentId);
    if (!agent || agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }
    const companyMetrics = db.getCompanyMetrics(token.companyId, 30);
    const agentMetric = companyMetrics.agentMetrics.find((metric) => metric.agentId === agentId);
    if (!agentMetric) {
      server.json(res, 404, { error: "Metrics not found" });
      return;
    }
    server.json(res, 200, agentMetric);
  });

  server.addRoute("GET", "/api/agents/:agentId", (_req, res, params, token) => {
    let agent;
    try {
      agent = db.getAgent(requireParam(params, "agentId"));
    } catch {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }
    if (agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }
    const directReports = db.getDirectReports(agent.id, token.companyId);
    const reportsTo = agent.reportsTo;
    const manager = reportsTo ? (() => { try { return db.getAgent(reportsTo); } catch { return null; } })() : null;
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
    const agents = db.queryAll<AgentListRow>(
      "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, updated_at as updatedAt from agents where company_id = ? order by created_at asc",
      params.companyId,
    ).map((a) => ({ ...a, heartbeatEnabled: Boolean(a.heartbeatEnabled) }));
    server.json(res, 200, agents);
  });

  server.addRoute("POST", "/api/companies/:companyId/agents", (_req, res, params, token, body) => {
    const companyId = requireParam(params, "companyId");
    if (companyId !== token.companyId) {
      server.json(res, 403, { error: "Company mismatch" });
      return;
    }
    if (!canRequestHire(db, companyId, token.agentId)) {
      server.json(res, 403, { error: "Current agent is not allowed to request hires" });
      return;
    }
    const reportsToProvided =
      typeof body === "object" &&
      body !== null &&
      Object.prototype.hasOwnProperty.call(body, "reportsTo");
    const parsed = hireRequestSchema.safeParse({
      companyId,
      requestedByAgentId: token.agentId,
      ...(typeof body === "object" && body ? body : {}),
    });
    if (!parsed.success) {
      server.json(res, 400, { error: "Invalid hire payload" });
      return;
    }
    const input = parsed.data;
    const resolvedReportsTo = resolveHireReportsTo(
      db,
      companyId,
      token.agentId,
      reportsToProvided ? input.reportsTo : undefined,
      input.department ?? null,
    );
    const nameError = getHireNameValidationError({
      name: input.name,
      role: input.role,
      title: input.title,
    });
    if (nameError) {
      server.json(res, 422, { error: nameError });
      return;
    }
    const routingError = getHireRoutingValidationError(
      db,
      companyId,
      token.agentId,
      resolvedReportsTo,
      input.department ?? null,
    );
    if (routingError) {
      server.json(res, 422, { error: routingError });
      return;
    }
    if (server.companyRefError(res, companyId, [
      { id: input.requestedByAgentId, table: "agents", label: "requesting agent" },
      { id: resolvedReportsTo, table: "agents", label: "manager" },
      { id: input.workspaceId, table: "workspaces", label: "workspace" },
    ])) {
      return;
    }
    if (
      resolvedReportsTo &&
      resolvedReportsTo !== token.agentId &&
      !canManageOrganization(db, companyId, token.agentId) &&
      !db.getChainOfCommand(resolvedReportsTo).some((agent) => agent.id === token.agentId)
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
    const existingAgents = db.queryAll<{ id: string; name: string; role: string }>(
      "select id, name, role from agents where company_id = ? and status != 'terminated'",
      companyId,
    );
    const duplicateByName = existingAgents.find(
      (a) => a.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (duplicateByName) {
      server.json(res, 409, { error: `Agent "${input.name}" already exists in this company (id: ${duplicateByName.id}, role: ${duplicateByName.role}). Use the existing agent instead of creating a duplicate.` });
      return;
    }
    // Also check pending hire approvals with the same name to prevent concurrent duplicate requests
    const pendingHires = db.queryAll<{ payloadJson: string | null }>(
      "select payload_json as payloadJson from approvals where company_id = ? and type = 'hire_agent' and state = 'pending'",
      companyId,
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

    const managerLabel = resolvedReportsTo
      ? (() => {
        try {
          return db.getAgent(resolvedReportsTo).name;
        } catch {
          return resolvedReportsTo;
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
        reportsTo: resolvedReportsTo,
        connectorId: input.connectorId,
        workspaceId: input.workspaceId ?? null,
        model: input.model ?? null,
        metadataJson: input.metadataJson ?? "{}",
        capabilities: input.capabilities,
        budgetMonthlyUsd: input.budgetMonthlyUsd,
        payloadSummary: `Hire ${input.name} as ${input.role}`,
        impactSummary: input.capabilities || `${input.name} will report to ${managerLabel}.`,
        payloadJson: JSON.stringify({
          name: input.name,
          role: input.role,
          title: input.title,
          requestedByAgentId: input.requestedByAgentId ?? token.agentId,
          requestedConfigurationSnapshot: {
            connectorId: input.connectorId,
            workspaceId: input.workspaceId ?? null,
            model: input.model ?? null,
            metadataJson: input.metadataJson ?? "{}",
            capabilities: input.capabilities,
            budgetMonthlyUsd: input.budgetMonthlyUsd,
            reportsTo: resolvedReportsTo,
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
