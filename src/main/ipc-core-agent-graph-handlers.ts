import {
  IPC_CHANNELS,
  agentInputSchema,
  deleteEntitySchema,
  hireRequestSchema,
  workspaceInputSchema,
} from "@shared/contracts";
import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import { resolveApprovalDecision } from "./approval-policy";
import { shouldAutoApprove } from "./execution-policy";
import { getHireNameValidationError, getHireRoutingValidationError, resolveHireReportsTo } from "./agent-permissions";
import { validateConnectorModelSelection } from "./connector-model-policy";
import { fail, ok, type RegisterCoreHandlersDependencies } from "./ipc-core-common";

export function registerCoreAgentGraphHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  findInvalidReference,
  publishDomainChanged,
  handleApprovalResolved,
  logger,
}: Pick<
  RegisterCoreHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "findInvalidReference"
  | "publishDomainChanged"
  | "handleApprovalResolved"
  | "logger"
>) {
  registerHandle(IPC_CHANNELS.saveWorkspace, async (_event, payload) => {
    const parsed = workspaceInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.projectId, table: "projects", label: "project" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.saveWorkspace(parsed);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "workspace.updated" : "workspace.created",
      entityType: "workspace",
      entityId: id,
      detail: parsed.localPath,
    });
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.saveAgent, async (_event, payload) => {
    const parsed = agentInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const isNew = !parsed.id;
    if (isNew) {
      return fail(
        "AGENT_CREATION_REQUIRES_HIRE_REQUEST",
        "Create new agents through the hiring workflow so approval, onboarding, and org state stay synchronized.",
      );
    }
    const existingAgent = parsed.id ? db.entityCrud.findAgent(parsed.id) : null;
    if (!existingAgent || existingAgent.companyId !== parsed.companyId) {
      return fail("AGENT_NOT_FOUND", "Agent not found in the current company.");
    }
    if (existingAgent.status === "pending_approval") {
      return fail(
        "AGENT_APPROVAL_REQUIRED",
        "Pending hires must be resolved from Hiring or Approvals. Direct edits, deletes, and activation changes are blocked here.",
      );
    }
    if (parsed.status === "pending_approval") {
      return fail(
        "AGENT_STATUS_LOCKED",
        "Active agents cannot be moved back to pending approval by editing status directly.",
      );
    }
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.reportsTo, table: "agents", label: "manager" },
      { id: parsed.workspaceId, table: "workspaces", label: "workspace" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const connectorRecord = db.findConnector(parsed.connectorId);
    if (!connectorRecord) {
      return fail("CONNECTOR_NOT_FOUND", "The selected connector does not exist.");
    }
    const connectorIssue = getConnectorExecutionReadinessIssue(connectorRecord);
    if (connectorIssue) {
      return fail("CONNECTOR_NOT_READY", connectorIssue);
    }
    const modelSelection = validateConnectorModelSelection(db, parsed.companyId, parsed.connectorId, parsed.model ?? null);
    if (!modelSelection.ok) {
      return fail("CONNECTOR_MODEL_NOT_ALLOWED", modelSelection.error);
    }
    let id: string;
    try {
      id = db.agents.saveAgent({
        id: parsed.id ?? null,
        companyId: parsed.companyId,
        name: parsed.name,
        role: parsed.role,
        title: parsed.title,
        department: parsed.department ?? null,
        status: parsed.status,
        reportsTo: parsed.reportsTo ?? null,
        connectorId: parsed.connectorId,
        workspaceId: parsed.workspaceId ?? null,
        model: parsed.model ?? null,
        metadataJson: parsed.metadataJson,
        capabilities: parsed.capabilities,
        budgetMonthlyUsd: parsed.budgetMonthlyUsd,
        // User edited this agent through the form and picked a specific
        // (connector, model). Respect their intent: pin the strategy to
        // `explicit` so the dispatcher never overrides their choice.
        modelStrategy: "explicit",
      });
    } catch (error) {
      return fail("INVALID_AGENT_HIERARCHY", error instanceof Error ? error.message : "Agent could not be saved.");
    }
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "agent.updated" : "agent.created",
      entityType: "agent",
      entityId: id,
      detail: parsed.name,
    });
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.requestHire, async (_event, payload) => {
    const parsed = hireRequestSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const resolvedReportsTo = resolveHireReportsTo(
      db,
      parsed.companyId,
      parsed.requestedByAgentId ?? null,
      parsed.reportsTo,
      parsed.department ?? null,
    );
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.requestedByAgentId, table: "agents", label: "requesting agent" },
      { id: resolvedReportsTo, table: "agents", label: "manager" },
      { id: parsed.workspaceId, table: "workspaces", label: "workspace" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const connectorRecord = db.findConnector(parsed.connectorId);
    if (!connectorRecord) {
      return fail("CONNECTOR_NOT_FOUND", "The selected connector does not exist.");
    }
    const connectorIssue = getConnectorExecutionReadinessIssue(connectorRecord);
    if (connectorIssue) {
      return fail("CONNECTOR_NOT_READY", connectorIssue);
    }
    const nameError = getHireNameValidationError({
      name: parsed.name,
      role: parsed.role,
      title: parsed.title,
    });
    if (nameError) {
      return fail("INVALID_HIRE_NAME", nameError);
    }
    const routingError = getHireRoutingValidationError(
      db,
      parsed.companyId,
      parsed.requestedByAgentId ?? null,
      parsed.reportsTo,
      parsed.department ?? null,
    );
    if (routingError) {
      return fail("INVALID_HIRE_ROUTING", routingError);
    }
    const modelSelection = validateConnectorModelSelection(db, parsed.companyId, parsed.connectorId, parsed.model ?? null);
    if (!modelSelection.ok) {
      return fail("CONNECTOR_MODEL_NOT_ALLOWED", modelSelection.error);
    }
    const managerLabel = resolvedReportsTo
      ? (() => {
        try {
          return db.entityCrud.getAgent(resolvedReportsTo).name;
        } catch (err) {
          logger.warn(`[ipc/agent-graph] getAgent failed for manager ${resolvedReportsTo}:`, err instanceof Error ? err.message : String(err));
          return resolvedReportsTo;
        }
      })()
      : "the company board";
    const payloadSummary = `Hire ${parsed.name} as ${parsed.role}`;
    const impactSummary = parsed.capabilities || `${parsed.name} will report to ${managerLabel}.`;
    let result: { agentId: string; approvalId: string };
    try {
      result = db.createHireRequest({
        companyId: parsed.companyId,
        requestedByAgentId: parsed.requestedByAgentId ?? null,
        name: parsed.name,
        role: parsed.role,
        title: parsed.title,
        department: parsed.department ?? null,
        reportsTo: resolvedReportsTo,
        connectorId: parsed.connectorId,
        workspaceId: parsed.workspaceId ?? null,
        model: parsed.model ?? null,
        metadataJson: parsed.metadataJson,
        capabilities: parsed.capabilities,
        budgetMonthlyUsd: parsed.budgetMonthlyUsd,
        payloadSummary,
        impactSummary,
        payloadJson: JSON.stringify({
          name: parsed.name,
          role: parsed.role,
          title: parsed.title,
          requestedByAgentId: parsed.requestedByAgentId ?? null,
          requestedConfigurationSnapshot: {
            connectorId: parsed.connectorId,
            workspaceId: parsed.workspaceId ?? null,
            model: parsed.model ?? null,
            metadataJson: parsed.metadataJson ?? "{}",
            capabilities: parsed.capabilities,
            budgetMonthlyUsd: parsed.budgetMonthlyUsd,
            reportsTo: resolvedReportsTo,
            department: parsed.department ?? null,
            title: parsed.title,
          },
        }),
      });
    } catch (error) {
      return fail("HIRE_REQUEST_FAILED", error instanceof Error ? error.message : "Hire request could not be created.");
    }

    db.addActivity({
      companyId: parsed.companyId,
      actor: parsed.requestedByAgentId ?? "board",
      action: "agent.hire_requested",
      entityType: "agent",
      entityId: result.agentId,
      detail: parsed.name,
    });

    let autoApproved = false;
    if (shouldAutoApprove(db, parsed.companyId, "hire_agent")) {
      resolveApprovalDecision({
        db,
        handleApprovalResolved,
        companyId: parsed.companyId,
        approvalId: result.approvalId,
        state: "approved",
        decisionNote: "Auto-approved by company policy",
        detail: "Auto-approved by company policy",
      });
      autoApproved = true;
    }

    publishDomainChanged();
    return ok({ ...result, autoApproved });
  });

  registerHandle(IPC_CHANNELS.deleteAgent, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("agents", parsed.id, parsed.companyId)) {
      return fail("AGENT_NOT_FOUND", "Agent not found in the current company.");
    }
    const agent = db.entityCrud.getAgent(parsed.id);
    if (agent.status === "pending_approval") {
      return fail(
        "AGENT_APPROVAL_REQUIRED",
        "Pending hires cannot be deleted from the agent editor. Reject the hire request from Hiring or Approvals instead.",
      );
    }
    db.agents.deleteAgent(parsed.id, parsed.companyId);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: "agent.deleted",
      entityType: "agent",
      entityId: parsed.id,
      detail: "",
    });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteApproval, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("approvals", parsed.id, parsed.companyId)) {
      return fail("APPROVAL_NOT_FOUND", "Approval not found in the current company.");
    }
    const approval = db.approvalsMod.getApprovalRecord(parsed.id);
    if (approval.state === "pending" && approval.type === "hire_agent") {
      return fail(
        "APPROVAL_DELETE_BLOCKED",
        "Pending hire approvals cannot be deleted. Reject the hire request instead so the linked agent record stays consistent.",
      );
    }
    db.approvalsMod.deleteApproval(parsed.id, parsed.companyId);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: "approval.deleted",
      entityType: "approval",
      entityId: parsed.id,
      detail: "",
    });
    publishDomainChanged();
    return ok(true);
  });
}
