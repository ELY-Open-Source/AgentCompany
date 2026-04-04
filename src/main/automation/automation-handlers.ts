import type { AppDatabase } from "../database";
import type { NotificationOptions } from "../notification-service";
import type { AutomationEventContext } from "./types";

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
  dispatchBrowserAction: (actionId: string, companyId: string) => Promise<void>;
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
  if (previousStatus === newStatus) return;
  const { db, wakeAgentIfPossible } = deps;
  const { dispatchAutomation } = callbacks;

  let task: ReturnType<typeof db.getTask> | null = null;
  try {
    task = db.getTask(taskId);
  } catch {
    return;
  }
  if (!task) return;

  db.addActivity({
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
      const agent = db.getAgent(task.assigneeAgentId);
      context.department = agent.department ?? undefined;
    }
  } catch {
    // Agent may have been deleted after the task update; keep the transition without department context.
  }

  dispatchAutomation("task_status_changed", context);

  if (newStatus === "blocked") {
    dispatchAutomation("task_blocked", context);
    if (task.assigneeAgentId) {
      const manager = db.getManagerForAgent(task.assigneeAgentId);
      if (manager) {
        wakeAgentIfPossible(manager.id, companyId, "report_blocked");
      }
    }
  }

  if (newStatus === "done" && task.parentId) {
    try {
      const siblings = db.listChildTasks(task.parentId, companyId);
      const allDone = siblings.every((entry) => entry.id === taskId ? true : entry.status === "done");
      if (allDone) {
        const parent = db.getTask(task.parentId);
        if (parent.assigneeAgentId) {
          wakeAgentIfPossible(parent.assigneeAgentId, companyId, "subtask_completed");
        } else {
          const assignedId = db.autoAssignTask(parent.id, companyId);
          if (assignedId) {
            wakeAgentIfPossible(assignedId, companyId, "subtask_completed");
          }
        }
      }
    } catch {
      // Parent task may have been deleted or reassigned during completion cascade evaluation.
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

  let task: ReturnType<typeof db.getTask> | null = null;
  try {
    task = db.getTask(taskId);
  } catch {
    return;
  }
  if (!task) return;

  dispatchAutomation("task_created", {
    companyId,
    taskId,
    agentId: task.assigneeAgentId ?? undefined,
  });

  if (!task.assigneeAgentId) {
    const assignedId = db.autoAssignTask(taskId, companyId);
    if (assignedId) {
      wakeAgentIfPossible(assignedId, companyId, "assignment");
    }
  } else {
    wakeAgentIfPossible(task.assigneeAgentId, companyId, "assignment");
  }
}
