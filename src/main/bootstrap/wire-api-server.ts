import log from "electron-log/main.js";
import type { AgentApiServer } from "../api-server";
import type { AppDatabase } from "../database";
import type { DesktopEvent, SectionId } from "@shared/types";
import type { NotificationOptions } from "../notification-service";
import type { createServiceGraph } from "../service-graph";
import type { createThreadIntegration } from "../thread-integration";
import type { createCheckpointEngine } from "../checkpoint-engine";
import type { AutomationEventContext } from "../automation/types";

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
    onDocumentCreated: (companyId: string, authorAgentId: string | null, projectId: string | null, documentId: string, documentTitle: string, documentType: string, taskId: string | null) => void;
    onAutoAssignTask: (taskId: string, companyId: string) => string | null;
    onHumanMessage: (companyId: string, toAgentId?: string | null, threadId?: string | null, waitStateId?: string | null) => void;
    emitEvent: (event: DesktopEvent) => void;
    notify: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string }; batchKey?: string }) => void;
  }, allowedOrigins: string[]): AgentApiServer;
}

export interface WireApiServerDeps {
  db: AppDatabase;
  serviceGraph: ServiceGraph;
  threadIntegration: ThreadIntegration;
  checkpointEngine: CheckpointEngine;
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
        const task = deps.db.getTask(taskId);
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
    onApprovalCreated: (approvalId, companyId, taskId, approvalType, summary) => {
      deps.threadIntegration.onApprovalCreated(approvalId, companyId, taskId, approvalType, summary);
    },
    onApprovalResolved,
    onDocumentCreated: (companyId, authorAgentId, projectId, documentId, documentTitle, documentType, taskId) => {
      dispatchAutomation("document_created", { companyId, agentId: authorAgentId ?? undefined, projectId: projectId ?? undefined });
      deps.threadIntegration.onDocumentCreated(companyId, authorAgentId, taskId, documentTitle);
      deps.checkpointEngine.onDocumentDrafted(companyId, documentId, documentTitle, documentType, authorAgentId, taskId);
    },
    onAutoAssignTask: (taskId, companyId) => deps.db.autoAssignTask(taskId, companyId),
    onHumanMessage: (companyId, toAgentId, threadId, waitStateId) => {
      deps.threadIntegration.onHumanMessage(companyId, toAgentId, threadId, waitStateId);
      deps.publishDomainChanged();
    },
    emitEvent: deps.emitEvent,
    notify: deps.notify,
  }, allowedOrigins);
}
