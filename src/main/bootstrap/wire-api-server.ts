import log from "electron-log/main.js";
import type { AgentApiServer } from "../api-server";
import type { AppDatabase } from "../database";
import type { AgentMessageRecord, DesktopEvent, SectionId } from "@shared/types";
import type { NotificationOptions } from "../notification-service";
import type { createServiceGraph } from "../service-graph";
import type { createThreadIntegration } from "../thread-integration";
import type { createCheckpointEngine } from "../checkpoint-engine";
import type { AutomationEventContext } from "../automation/types";
import {
  createDocumentWithLifecycle,
  type DocumentLifecycleInput,
  type DocumentLifecycleOutcome,
} from "../document-lifecycle";
import type { DocumentLifecycleProcessor } from "../document-lifecycle-processor";

type ServiceGraph = ReturnType<typeof createServiceGraph>;
type ThreadIntegration = ReturnType<typeof createThreadIntegration>;
type CheckpointEngine = ReturnType<typeof createCheckpointEngine>;

export interface CreateApiServerFn {
  (db: AppDatabase, callbacks: {
    onDomainChanged: () => void;
    onWakeAgent: (agentId: string, companyId: string, trigger: string) => string | null;
    onTaskCreated: (taskId: string, companyId: string) => void;
    onTaskStatusChanged: (taskId: string, companyId: string, prev: string, next: string) => void;
    onCommentPosted: (taskId: string, companyId: string, authorAgentId: string | null) => void;
    onApprovalCreated: (approvalId: string, companyId: string, taskId: string | null, approvalType: string, summary: string) => void;
    onApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
    createDocument: (input: DocumentLifecycleInput) => DocumentLifecycleOutcome;
    onAutoAssignTask: (taskId: string, companyId: string) => string | null;
    onHumanMessage: (companyId: string, toAgentId?: string | null, threadId?: string | null, waitStateId?: string | null) => void;
    injectRuntimeMessage: (recipientAgentId: string, companyId: string, message: AgentMessageRecord) => boolean;
    emitEvent: (event: DesktopEvent) => void;
    notify: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string }; batchKey?: string }) => void;
  }, allowedOrigins: string[]): AgentApiServer;
}

export interface WireApiServerDeps {
  db: AppDatabase;
  serviceGraph: ServiceGraph;
  threadIntegration: ThreadIntegration;
  checkpointEngine: CheckpointEngine;
  lifecycleProcessor: DocumentLifecycleProcessor;
  emitEvent: (event: DesktopEvent) => void;
  notify: (options: NotificationOptions) => void;
  publishDomainChanged: () => void;
  isDev: boolean;
  devServerUrl?: string;
  createApiServer: CreateApiServerFn;
}

export function wireApiServer(deps: WireApiServerDeps): AgentApiServer {
  const wakeAgentIfPossible = (agentId: string | null | undefined, companyId: string, trigger: string) => {
    const orchestration = deps.serviceGraph.getOrchestrationService();
    if (!orchestration) throw new Error("Orchestration service is not initialized.");
    return orchestration.wakeAgentIfPossible(agentId, companyId, trigger);
  };
  const dispatchAutomation = (trigger: string, ctx: AutomationEventContext) => {
    const automation = deps.serviceGraph.getAutomationService();
    if (!automation) throw new Error("Automation service is not initialized.");
    automation.dispatchAutomation(trigger, ctx);
  };

  const onTaskCreated = (taskId: string, companyId: string) => {
    const automation = deps.serviceGraph.getAutomationService();
    if (!automation) throw new Error("Automation service is not initialized.");
    automation.handleTaskCreated(taskId, companyId);
    deps.threadIntegration.onTaskCreated(taskId, companyId);
  };
  const onTaskStatusChanged = (taskId: string, companyId: string, prev: string, next: string) => {
    const automation = deps.serviceGraph.getAutomationService();
    if (!automation) throw new Error("Automation service is not initialized.");
    automation.handleTaskStatusChange(taskId, companyId, prev, next);
    deps.threadIntegration.onTaskStatusChanged(taskId, companyId, prev, next);
    if (prev === "todo" && next === "in_progress") {
      try {
        const task = deps.db.entityCrud.getTask(taskId);
        deps.checkpointEngine.onTaskStarted(taskId, companyId, task.assigneeAgentId);
      } catch (error) {
        log.warn(
          `[wire-api-server] checkpointEngine.onTaskStarted failed for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };
  const onApprovalResolved = (approvalId: string, companyId: string, decision: string) => {
    const automation = deps.serviceGraph.getAutomationService();
    if (!automation) throw new Error("Automation service is not initialized.");
    automation.handleApprovalResolved(approvalId, companyId, decision);
    deps.threadIntegration.onApprovalResolved(approvalId, companyId, decision);
  };
  const onApprovalCreated = (
    approvalId: string,
    companyId: string,
    taskId: string | null,
    approvalType: string,
    summary: string,
  ) => {
    deps.threadIntegration.onApprovalCreated(approvalId, companyId, taskId, approvalType, summary);
  };

  // Cross-wire the same callbacks into the pi runtime bridge so the
  // internal-tool path (C4) triggers identical thread/automation
  // notifications as the HTTP route.
  const piRuntime = deps.serviceGraph.getPiRuntime();
  if (!piRuntime) {
    throw new Error("Pi runtime is not initialized; cannot wire internal-tool callbacks.");
  }
  piRuntime.runtimeBridge.setInternalToolCallbacks({
    onApprovalCreated,
    onApprovalResolved,
    onDomainChanged: deps.publishDomainChanged,
  });

  const allowedOrigins = [deps.isDev && deps.devServerUrl ? new URL(deps.devServerUrl).origin : null, "app://-"]
    .filter((origin): origin is string => Boolean(origin));

  return deps.createApiServer(deps.db, {
    onDomainChanged: deps.publishDomainChanged,
    onWakeAgent: (agentId, companyId, trigger) => wakeAgentIfPossible(agentId, companyId, trigger),
    onTaskCreated,
    onTaskStatusChanged,
    onCommentPosted: (taskId, companyId, authorAgentId) => {
      dispatchAutomation("comment_posted", { companyId, taskId, agentId: authorAgentId ?? undefined });
    },
    onApprovalCreated,
    onApprovalResolved,
    createDocument: (input) =>
      createDocumentWithLifecycle(
        {
          db: deps.db,
          threadIntegration: deps.threadIntegration,
          checkpointEngine: deps.checkpointEngine,
          lifecycleProcessor: deps.lifecycleProcessor,
          publishDomainChanged: deps.publishDomainChanged,
          logger: log,
        },
        input,
      ),
    onAutoAssignTask: (taskId, companyId) => deps.db.tasks.autoAssignTask(taskId, companyId),
    onHumanMessage: (companyId, toAgentId, threadId, waitStateId) => {
      deps.threadIntegration.onHumanMessage(companyId, toAgentId, threadId, waitStateId);
      deps.publishDomainChanged();
    },
    injectRuntimeMessage: (recipientAgentId, companyId, message) => {
      const injector = deps.serviceGraph.getRuntimeMessageInjector();
      if (!injector) return false;
      try {
        return injector.tryInject(recipientAgentId, companyId, message);
      } catch (error) {
        log.warn(
          `[wire-api-server] runtime message injection failed for agent ${recipientAgentId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },
    emitEvent: deps.emitEvent,
    notify: deps.notify,
  }, allowedOrigins);
}
