import {
  IPC_CHANNELS,
  deleteEntitySchema,
  goalInputSchema,
  projectInputSchema,
  taskInputSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterCoreHandlersDependencies } from "./ipc-core-common";
import { validateTaskCreation, checkCapabilityMatch } from "./task-quality-gates";

export function registerCoreTaskGraphHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  findInvalidReference,
  publishDomainChanged,
  emitEvent,
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
  | "emitEvent"
  | "wakeAgentIfPossible"
  | "handleTaskCreated"
  | "handleTaskStatusChange"
>) {
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
    if (isNew) {
      const isHeartbeat = parsed.title.startsWith("[Heartbeat]");
      const validation = validateTaskCreation(parsed, isHeartbeat);
      if (!validation.valid) {
        return fail("TASK_VALIDATION_FAILED", validation.errors.join("; "));
      }
    }
    let previousStatus: string | null = null;
    let previousAssigneeAgentId: string | null = null;
    if (!isNew) {
      const taskId = parsed.id;
      if (!taskId) return fail("INVALID_TASK_STATE", "Task ID required for updates.");
      try {
        const existingTask = db.getTask(taskId);
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
    let capabilityWarning: string | undefined;
    if (isNew && parsed.assigneeAgentId) {
      try {
        const match = checkCapabilityMatch(db, parsed.assigneeAgentId, parsed.description, parsed.companyId);
        if (!match.matched) {
          capabilityWarning = match.warning;
        }
      } catch { /* capability check is advisory — never block task creation */ }
    }
    emitEvent({ type: "task-updated", taskId: id, action: isNew ? "created" : "updated" });
    return ok({ id, capabilityWarning });
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
      if (entity === "task") {
        emitEvent({ type: "task-updated", taskId: parsed.id, action: "deleted" });
      } else {
        publishDomainChanged();
      }
      return ok(true);
    });
  }
}
