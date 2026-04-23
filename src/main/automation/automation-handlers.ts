import type { AppDatabase } from "../database";
import type { NotificationOptions } from "../notification-service";
import type { AutomationEventContext } from "./types";
import { logAppError } from "../errors/index.js";

export interface HandlerDeps {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  publishDomainChanged: () => void;
  notify: (options: NotificationOptions) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  queueBrowserActionExecution: (actionId: string, companyId: string) => void;
  isQuitting: () => boolean;
}

export interface HandlerCallbacks {
  dispatchAutomation: (trigger: string, ctx: AutomationEventContext) => void;
  handleTaskStatusChange: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => void;
  runWorkflowPipeline: (workflowId: string, companyId: string) => Promise<void>;
}

export function handleTaskStatusChange(
  deps: HandlerDeps,
  callbacks: Pick<HandlerCallbacks, "dispatchAutomation">,
  taskId: string,
  companyId: string,
  previousStatus: string,
  newStatus: string,
): void {
  if (deps.isQuitting()) return;
  if (previousStatus === newStatus) {
    // Caller should gate this; log the no-op so the offender can be traced.
    deps.logger.warn(
      `[automation] handleTaskStatusChange called with no-op status (${previousStatus}) for task ${taskId} — caller should gate this.`,
    );
    return;
  }
  const { db, wakeAgentIfPossible } = deps;
  const { dispatchAutomation } = callbacks;

  let task: ReturnType<typeof db.core.entity.getTask> | null = null;
  try {
    task = db.core.entity.getTask(taskId);
  } catch (error) {
    logAppError(deps.logger, error, {
      kind: "recoverable",
      code: "automation.task_status_change.task_not_found",
      message: `handleTaskStatusChange: task ${taskId} disappeared before handler could read it`,
      context: { taskId, companyId },
    }, "warn");
    return;
  }
  if (!task) return;

  db.core.activity.addActivity({
    companyId,
    actor: task.assigneeAgentId ?? "board",
    action: "task.status_changed",
    entityType: "task",
    entityId: taskId,
    detail: `${previousStatus} → ${newStatus}`,
  });

  const context: AutomationEventContext = {
    companyId,
    taskId,
    agentId: task.assigneeAgentId ?? undefined,
    previousStatus,
    newStatus,
  };
  try {
    if (task.assigneeAgentId) {
      const agent = db.core.entity.getAgent(task.assigneeAgentId);
      context.department = agent.department ?? undefined;
    }
  } catch (error) {
    logAppError(deps.logger, error, {
      kind: "recoverable",
      code: "automation.task_status_change.assignee_deleted",
      message: `Agent ${task.assigneeAgentId} deleted after task update; continuing without department context`,
      context: { taskId, agentId: task.assigneeAgentId, companyId },
    }, "warn");
  }

  dispatchAutomation("task_status_changed", context);

  if (newStatus === "blocked") {
    dispatchAutomation("task_blocked", context);
    if (task.assigneeAgentId) {
      const manager = db.core.agents.getManagerForAgent(task.assigneeAgentId);
      if (manager) {
        wakeAgentIfPossible(manager.id, companyId, "report_blocked");
      }
    }
  }

  if (newStatus === "done" && task.parentId) {
    try {
      const siblings = db.core.tasks.listChildTasks(task.parentId, companyId);
      const allDone = siblings.every((entry) => entry.id === taskId ? true : entry.status === "done");
      if (allDone) {
        const parent = db.core.entity.getTask(task.parentId);
        if (parent.assigneeAgentId) {
          wakeAgentIfPossible(parent.assigneeAgentId, companyId, "subtask_completed");
        } else {
          const assignedId = db.core.tasks.autoAssignTask(parent.id, companyId);
          if (assignedId) {
            wakeAgentIfPossible(assignedId, companyId, "subtask_completed");
          }
        }
      }
    } catch (err) {
      logAppError(deps.logger, err, {
        kind: "recoverable",
        code: "automation.task_status_change.parent_lookup_failed",
        message: `Parent task ${task.parentId} lookup failed during completion cascade`,
        context: { taskId, parentTaskId: task.parentId, companyId },
      }, "warn");
    }
  }
}

export function handleTaskCreated(
  deps: HandlerDeps,
  callbacks: Pick<HandlerCallbacks, "dispatchAutomation">,
  taskId: string,
  companyId: string,
): void {
  if (deps.isQuitting()) return;
  const { db, wakeAgentIfPossible } = deps;
  const { dispatchAutomation } = callbacks;

  let task: ReturnType<typeof db.core.entity.getTask> | null = null;
  try {
    task = db.core.entity.getTask(taskId);
  } catch (error) {
    logAppError(deps.logger, error, {
      kind: "recoverable",
      code: "automation.task_created.task_not_found",
      message: `handleTaskCreated: task ${taskId} disappeared before handler could read it`,
      context: { taskId, companyId },
    }, "warn");
    return;
  }
  if (!task) return;

  dispatchAutomation("task_created", {
    companyId,
    taskId,
    agentId: task.assigneeAgentId ?? undefined,
  });

  if (!task.assigneeAgentId) {
    const assignedId = db.core.tasks.autoAssignTask(taskId, companyId);
    if (assignedId) {
      wakeAgentIfPossible(assignedId, companyId, "assignment");
    }
  } else {
    wakeAgentIfPossible(task.assigneeAgentId, companyId, "assignment");
  }
}
