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
import { resolveApprovalDecision } from "../approval-policy";
import { shouldAutoApprove } from "../execution-policy";
import { requireParam, type AgentApiServer } from "./server-core";

export function registerAgentRoutes(server: AgentApiServer) {
  const db = server.db;
  const callbacks = server.callbacks;
  const onDomainChanged = server.onDomainChanged;
  server.addRoute("GET", "/api/agents/me", (_req, res, _params, token) => {
    const agent = db.entityCrud.getAgent(token.agentId);
    const chainOfCommand = db.agents.getChainOfCommand(token.agentId);
    const directReports = db.agents.getDirectReports(token.agentId, token.companyId);
    server.json(res, 200, { agent, chainOfCommand, directReports });
  });

  // GET /api/agents/me/standup lives in routes-agents-standup.ts, which
  // uses targeted standup-shaped DB queries. The inline duplicate that
  // used to sit here was dead code — the router keeps the first match
  // and the standup module is registered separately in api-server/index.ts.

  server.addRoute("GET", "/api/agents/me/metrics", (_req, res, _params, token) => {
    const companyMetrics = db.company.getCompanyMetrics(token.companyId, 30);
    const agentMetric = companyMetrics.agentMetrics.find(m => m.agentId === token.agentId);
    if (!agentMetric) {
      server.json(res, 404, { error: "Metrics not found" });
      return;
    }
    server.json(res, 200, agentMetric);
  });

  server.addRoute("GET", "/api/agents/:agentId/metrics", (_req, res, params, token) => {
    const agentId = requireParam(params, "agentId");
    const agent = db.entityCrud.getAgent(agentId);
    if (!agent || agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }
    const companyMetrics = db.company.getCompanyMetrics(token.companyId, 30);
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
      agent = db.entityCrud.getAgent(requireParam(params, "agentId"));
    } catch (err) {
      log.warn(`[api/agents] getAgent failed:`, err instanceof Error ? err.message : String(err));
      server.json(res, 404, { error: "Agent not found" });
      return;
    }
    if (agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }
    const directReports = db.agents.getDirectReports(agent.id, token.companyId);
    const reportsTo = agent.reportsTo;
    const manager = reportsTo
      ? (() => {
          try {
            return db.entityCrud.getAgent(reportsTo);
          } catch (error) {
            log.warn(`[api/agents] manager lookup failed for ${reportsTo}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          }
        })()
      : null;
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
    const agents = db.agents.listAgentsForApi(params.companyId);
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
      !db.agents.getChainOfCommand(resolvedReportsTo).some((agent) => agent.id === token.agentId)
    ) {
      server.json(res, 403, { error: "Requested hire must report to you or a manager in your reporting chain." });
      return;
    }
    const connectorRecord = (() => {
      try {
        return db.connectorsCrud.getConnector(input.connectorId);
      } catch (err) {
        log.warn(`[api/agents] getConnector failed for ${input.connectorId}:`, err instanceof Error ? err.message : String(err));
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
    const existingAgents = db.agents.listExistingAgentsForHireCheck(companyId);
    const duplicateByName = existingAgents.find(
      (a) => a.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (duplicateByName) {
      server.json(res, 409, { error: `Agent "${input.name}" already exists in this company (id: ${duplicateByName.id}, role: ${duplicateByName.role}). Use the existing agent instead of creating a duplicate.` });
      return;
    }
    // Also check pending hire approvals with the same name to prevent concurrent duplicate requests
    const pendingHires = db.approvalsMod.listPendingHireApprovalPayloads(companyId);
    for (const pending of pendingHires) {
      try {
        const payload = pending.payloadJson ? JSON.parse(pending.payloadJson) as Record<string, unknown> : {};
        if (typeof payload.name === "string" && payload.name.toLowerCase() === input.name.toLowerCase()) {
          server.json(res, 409, { error: `A hire request for "${input.name}" is already pending approval.` });
          return;
        }
      } catch (error) {
        log.warn(
          `[api/agents] invalid pending-hire payloadJson for company ${companyId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const managerLabel = resolvedReportsTo
      ? (() => {
        try {
          return db.entityCrud.getAgent(resolvedReportsTo).name;
        } catch (err) {
          log.warn(`[api/agents] getAgent failed for manager ${resolvedReportsTo}:`, err instanceof Error ? err.message : String(err));
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

    db.activityMod.addActivity({
      companyId,
      actor: token.agentId,
      action: "agent.hire_requested",
      entityType: "agent",
      entityId: result.agentId,
      detail: input.name,
    });

    let autoApproved = false;
    if (shouldAutoApprove(db, companyId, "hire_agent")) {
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
