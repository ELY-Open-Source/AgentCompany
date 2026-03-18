import {
  IPC_CHANNELS,
  agentInputSchema,
  deleteEntitySchema,
  goalInputSchema,
  projectInputSchema,
  taskInputSchema,
  workspaceInputSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterCoreHandlersDependencies } from "./ipc-core-common";

export function registerCoreWorkGraphHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  findInvalidReference,
  publishDomainChanged,
  wakeAgentIfPossible,
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
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.reportsTo, table: "agents", label: "manager" },
      { id: parsed.workspaceId, table: "workspaces", label: "workspace" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
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
    if (!isNew) {
      try {
        previousStatus = db.getTask(parsed.id!).status;
      } catch {
        previousStatus = null;
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
    } else if (previousStatus && previousStatus !== parsed.status) {
      handleTaskStatusChange(id, parsed.companyId, previousStatus, parsed.status);
    }
    publishDomainChanged();
    return ok(id);
  });

  const deleteHandlers = [
    { channel: IPC_CHANNELS.deleteAgent, table: "agents", entity: "agent", deleteFn: (id: string, companyId: string) => db.deleteAgent(id, companyId) },
    { channel: IPC_CHANNELS.deleteTask, table: "tasks", entity: "task", deleteFn: (id: string, companyId: string) => db.deleteTask(id, companyId) },
    { channel: IPC_CHANNELS.deleteGoal, table: "goals", entity: "goal", deleteFn: (id: string, companyId: string) => db.deleteGoal(id, companyId) },
    { channel: IPC_CHANNELS.deleteProject, table: "projects", entity: "project", deleteFn: (id: string, companyId: string) => db.deleteProject(id, companyId) },
    { channel: IPC_CHANNELS.deleteWorkspace, table: "workspaces", entity: "workspace", deleteFn: (id: string, companyId: string) => db.deleteWorkspace(id, companyId) },
    { channel: IPC_CHANNELS.deleteApproval, table: "approvals", entity: "approval", deleteFn: (id: string, companyId: string) => db.deleteApproval(id, companyId) },
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
