import {
  IPC_CHANNELS,
  agentInputSchema,
  deleteEntitySchema,
  goalInputSchema,
  hireRequestSchema,
  projectInputSchema,
  taskInputSchema,
  workspaceInputSchema,
} from "@shared/contracts";
import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import { resolveApprovalDecision, shouldAutoApproveApproval } from "./approval-policy";
import { fail, ok, type RegisterCoreHandlersDependencies } from "./ipc-core-common";

export function registerCoreWorkGraphHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  findInvalidReference,
  publishDomainChanged,
  wakeAgentIfPossible,
  handleApprovalResolved,
  handleTaskCreated,
  handleTaskStatusChange,
}: Pick<
  RegisterCoreHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "findInvalidReference"
  | "publishDomainChanged"
  | "wakeAgentIfPossible"
  | "handleApprovalResolved"
  | "handleTaskCreated"
  | "handleTaskStatusChange"
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
    const existingAgent = (() => {
      try {
        return db.getAgent(parsed.id!);
      } catch {
        return null;
      }
    })();
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
    const connectorRecord = (() => {
      try {
        return db.getConnector(parsed.connectorId);
      } catch {
        return null;
      }
    })();
    if (!connectorRecord) {
      return fail("CONNECTOR_NOT_FOUND", "The selected connector does not exist.");
    }
    const connectorIssue = getConnectorExecutionReadinessIssue(connectorRecord);
    if (connectorIssue) {
      return fail("CONNECTOR_NOT_READY", connectorIssue);
    }
    let id: string;
    try {
      id = db.saveAgent({
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
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.requestedByAgentId, table: "agents", label: "requesting agent" },
      { id: parsed.reportsTo, table: "agents", label: "manager" },
      { id: parsed.workspaceId, table: "workspaces", label: "workspace" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const connectorRecord = (() => {
      try {
        return db.getConnector(parsed.connectorId);
      } catch {
        return null;
      }
    })();
    if (!connectorRecord) {
      return fail("CONNECTOR_NOT_FOUND", "The selected connector does not exist.");
    }
    const connectorIssue = getConnectorExecutionReadinessIssue(connectorRecord);
    if (connectorIssue) {
      return fail("CONNECTOR_NOT_READY", connectorIssue);
    }
    const managerLabel = parsed.reportsTo
      ? (() => {
        try {
          return db.getAgent(parsed.reportsTo).name;
        } catch {
          return parsed.reportsTo;
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
        reportsTo: parsed.reportsTo ?? null,
        connectorId: parsed.connectorId,
        workspaceId: parsed.workspaceId ?? null,
        model: parsed.model ?? null,
        metadataJson: parsed.metadataJson,
        capabilities: parsed.capabilities,
        budgetMonthlyUsd: parsed.budgetMonthlyUsd,
        payloadSummary,
        impactSummary,
        payloadJson: JSON.stringify({
          requestedByAgentId: parsed.requestedByAgentId ?? null,
          requestedConfigurationSnapshot: {
            connectorId: parsed.connectorId,
            workspaceId: parsed.workspaceId ?? null,
            model: parsed.model ?? null,
            metadataJson: parsed.metadataJson ?? "{}",
            capabilities: parsed.capabilities,
            budgetMonthlyUsd: parsed.budgetMonthlyUsd,
            reportsTo: parsed.reportsTo ?? null,
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
    if (shouldAutoApproveApproval(db, parsed.companyId, "hire_agent")) {
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

  registerHandle(IPC_CHANNELS.saveGoal, async (_event, payload) => {
    const parsed = goalInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.parentId, table: "goals", label: "parent goal" },
      { id: parsed.ownerAgentId, table: "agents", label: "owner agent" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.saveGoal(parsed);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "goal.updated" : "goal.created",
      entityType: "goal",
      entityId: id,
      detail: parsed.title,
    });
    publishDomainChanged();
    if (parsed.status === "active" && parsed.ownerAgentId) {
      wakeAgentIfPossible(parsed.ownerAgentId, parsed.companyId, "goal_activated");
    }
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.saveProject, async (_event, payload) => {
    const parsed = projectInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.goalId, table: "goals", label: "goal" },
      { id: parsed.leadAgentId, table: "agents", label: "lead agent" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.saveProject(parsed);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "project.updated" : "project.created",
      entityType: "project",
      entityId: id,
      detail: parsed.name,
    });
    if (parsed.leadAgentId) {
      wakeAgentIfPossible(parsed.leadAgentId, parsed.companyId, "assignment");
    }
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.saveTask, async (_event, payload) => {
    const parsed = taskInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.projectId, table: "projects", label: "project" },
      { id: parsed.goalId, table: "goals", label: "goal" },
      { id: parsed.parentId, table: "tasks", label: "parent task" },
      { id: parsed.assigneeAgentId, table: "agents", label: "assignee agent" },
      { id: parsed.workspaceId, table: "workspaces", label: "workspace" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const isNew = !parsed.id;
    let previousStatus: string | null = null;
    let previousAssigneeAgentId: string | null = null;
    if (!isNew) {
      try {
        const existingTask = db.getTask(parsed.id!);
        previousStatus = existingTask.status;
        previousAssigneeAgentId = existingTask.assigneeAgentId;
      } catch {
        previousStatus = null;
        previousAssigneeAgentId = null;
      }
    }
    let id: string;
    try {
      id = db.saveTask(parsed);
    } catch (error) {
      return fail("INVALID_TASK_STATE", error instanceof Error ? error.message : "Task could not be saved.");
    }
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: isNew ? "task.created" : "task.updated",
      entityType: "task",
      entityId: id,
      detail: parsed.title,
    });
    if (isNew) {
      handleTaskCreated(id, parsed.companyId);
    } else {
      if (previousStatus && previousStatus !== parsed.status) {
        handleTaskStatusChange(id, parsed.companyId, previousStatus, parsed.status);
      }
      // User (board) manually advancing a flagged task to done: clear the review flag
      if (parsed.status === "done") {
        try { db.setTaskRequiresUserReview(id, false); } catch { /* best effort */ }
      }
      // Wake new assignee when task is reassigned (matches api-server.ts behavior)
      if (parsed.assigneeAgentId && parsed.assigneeAgentId !== previousAssigneeAgentId) {
        wakeAgentIfPossible(parsed.assigneeAgentId, parsed.companyId, "assignment");
      }
    }
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteAgent, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("agents", parsed.id, parsed.companyId)) {
      return fail("AGENT_NOT_FOUND", "Agent not found in the current company.");
    }
    const agent = db.getAgent(parsed.id);
    if (agent.status === "pending_approval") {
      return fail(
        "AGENT_APPROVAL_REQUIRED",
        "Pending hires cannot be deleted from the agent editor. Reject the hire request from Hiring or Approvals instead.",
      );
    }
    db.deleteAgent(parsed.id, parsed.companyId);
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
    const approval = db.getApprovalRecord(parsed.id);
    if (approval.state === "pending" && approval.type === "hire_agent") {
      return fail(
        "APPROVAL_DELETE_BLOCKED",
        "Pending hire approvals cannot be deleted. Reject the hire request instead so the linked agent record stays consistent.",
      );
    }
    db.deleteApproval(parsed.id, parsed.companyId);
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

  const deleteHandlers = [
    { channel: IPC_CHANNELS.deleteTask, table: "tasks", entity: "task", deleteFn: (id: string, companyId: string) => db.deleteTask(id, companyId) },
    { channel: IPC_CHANNELS.deleteGoal, table: "goals", entity: "goal", deleteFn: (id: string, companyId: string) => db.deleteGoal(id, companyId) },
    { channel: IPC_CHANNELS.deleteProject, table: "projects", entity: "project", deleteFn: (id: string, companyId: string) => db.deleteProject(id, companyId) },
    { channel: IPC_CHANNELS.deleteWorkspace, table: "workspaces", entity: "workspace", deleteFn: (id: string, companyId: string) => db.deleteWorkspace(id, companyId) },
  ] as const;

  for (const { channel, table, entity, deleteFn } of deleteHandlers) {
    registerHandle(channel, async (_event, payload) => {
      const parsed = deleteEntitySchema.parse(payload);
      const companyError = ensureCompanyExists(parsed.companyId);
      if (companyError) return companyError;
      if (!db.belongsToCompany(table, parsed.id, parsed.companyId)) {
        return fail(`${entity.toUpperCase()}_NOT_FOUND`, `${entity.charAt(0).toUpperCase() + entity.slice(1)} not found in the current company.`);
      }
      deleteFn(parsed.id, parsed.companyId);
      db.addActivity({
        companyId: parsed.companyId,
        actor: "board",
        action: `${entity}.deleted`,
        entityType: entity,
        entityId: parsed.id,
        detail: "",
      });
      publishDomainChanged();
      return ok(true);
    });
  }
}
