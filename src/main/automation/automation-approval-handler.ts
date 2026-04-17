import { z } from "zod";
import type { AppDatabase } from "../database";
import type { NotificationOptions } from "../notification-service";
import { extractApprovalDocumentIds } from "@shared/approval-documents";
import { notifyHireApproved } from "../hire-hook";
import { autoAssignSkillsToAgent } from "./automation-skills";
import type { AutomationEventContext } from "./types";
import { normalizeWorkflowSteps } from "./automation-workflow";

const workflowApprovalPayloadSchema = z.object({
  workflowId: z.string().optional(),
  stepId: z.string().optional(),
  stepName: z.string().optional(),
}).passthrough();

function localizeNotification(locale: string | null | undefined, en: string, zh: string): string {
  return locale === "zh" ? zh : en;
}

function recordReviewFeedbackKnowledge(
  db: AppDatabase,
  approval: {
    companyId: string;
    relatedTaskId: string | null;
    requestedByAgentId: string | null;
    decisionNote: string | null;
  },
  decision: string,
): void {
  if (!approval.relatedTaskId) return;
  if (decision === "approved") return;

  const task = db.getTask(approval.relatedTaskId);
  const feedback = approval.decisionNote?.trim() || "Board requested revisions before approval.";
  const topic = `Review feedback: ${task.title}`;
  const content = [
    `Decision: ${decision}`,
    `Feedback: ${feedback}`,
    "Use this review guidance to improve future deliverables for similar work.",
  ].join("\n");

  db.saveKnowledgeEntry({
    companyId: approval.companyId,
    category: "lesson_learned",
    topic,
    content,
    authorAgentId: approval.requestedByAgentId ?? null,
    importance: "high",
    tagsJson: JSON.stringify(["review_feedback", decision]),
    referencedEntityType: "task",
    referencedEntityId: task.id,
  });
}

export interface ApprovalHandlerDeps {
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

export interface ApprovalHandlerCallbacks {
  dispatchAutomation: (trigger: string, ctx: AutomationEventContext) => void;
  handleTaskStatusChange: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => void;
  runWorkflowPipeline: (workflowId: string, companyId: string) => Promise<void>;
  trackTimer: (timer: ReturnType<typeof setTimeout>) => void;
}

export function handleApprovalResolved(
  deps: ApprovalHandlerDeps,
  callbacks: ApprovalHandlerCallbacks,
  approvalId: string,
  companyId: string,
  decision: string,
): void {
  if (deps.isQuitting()) return;
  const { db, logger, publishDomainChanged, notify, wakeAgentIfPossible, dispatchBrowserAction } = deps;
  const { dispatchAutomation, handleTaskStatusChange, runWorkflowPipeline, trackTimer } = callbacks;

  const snapshot = db.listSnapshot();
  const approval = snapshot.approvals.find((entry) => entry.id === approvalId);
  if (!approval) return;

  dispatchAutomation("approval_resolved", {
    companyId,
    agentId: approval.requestedByAgentId ?? undefined,
    taskId: approval.relatedTaskId ?? undefined,
  });

  if (approval.type === "hire_agent" && decision === "approved" && approval.relatedAgentId) {
    try {
      const agent = db.getAgent(approval.relatedAgentId);

      if (agent.status === "idle") {
        db.addActivity({
          companyId,
          actor: "system",
          action: "agent.hired",
          entityType: "agent",
          entityId: agent.id,
          detail: `${agent.name} hire approved and activated.`,
        });

        const skillsAssigned = autoAssignSkillsToAgent(db, logger, companyId, agent.id);
        if (skillsAssigned > 0) {
          db.addActivity({
            companyId,
            actor: "system",
            action: "skills.auto_assigned",
            entityType: "agent",
            entityId: agent.id,
            detail: `Auto-assigned ${skillsAssigned} skill(s) to ${agent.name} based on role/department matching.`,
          });
        }

        dispatchAutomation("hire_approved", {
          companyId,
          agentId: agent.id,
        });
        wakeAgentIfPossible(agent.id, companyId, "assignment");

        const ceo = db.getCeoForCompany(companyId);
        if (ceo && ceo.id !== agent.id) {
          wakeAgentIfPossible(ceo.id, companyId, "assignment");
        }

        publishDomainChanged();
        const hireLocale = db.listSnapshot().locale;
        notify({
          title: localizeNotification(hireLocale, "Agent Hired", "新员工入职"),
          body: localizeNotification(hireLocale, `${agent.name} joined as ${agent.role}`, `${agent.name} 已加入，职位：${agent.role}`),
          urgency: "informational",
          navigation: { section: "orgchart", entityId: agent.id },
          batchKey: "agent_hired",
        });

        // Notify adapter that hire was approved (Paperclip hire-hook parity)
        void notifyHireApproved(db, {
          companyId,
          agentId: agent.id,
          source: "approval",
          sourceId: approvalId,
          approvedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    } catch {
      // Hire follow-up is best-effort; approval state is already committed in storage.
    }
  }

  if (approval.type === "deliverable_review") {
    try {
      // Update linked document statuses from payloadJson
      const documentIds = extractApprovalDocumentIds(approval.payloadJson);
      const docStatus = decision === "approved"
        ? "approved"
        : decision === "rejected" || decision === "revision_requested"
          ? "draft"
          : "in_review";
      for (const docId of documentIds) {
        db.updateDocumentStatus(docId, companyId, docStatus);
      }

      if (approval.relatedTaskId) {
        const task = db.getTask(approval.relatedTaskId);
        if (task.assigneeAgentId) {
          try {
            const agent = db.getAgent(task.assigneeAgentId);
            if (!agent.heartbeatEnabled) {
              db.setHeartbeat(task.assigneeAgentId, true, agent.heartbeatIntervalSec || 120);
              logger.info(`[deliverable-review] Resumed heartbeat for ${agent.name} after user ${decision}.`);
            }
          } catch { /* agent lookup non-fatal */ }
        }
        if (decision === "approved") {
          db.advanceTaskStatus(task.id, "done", "Board approved deliverable.");
          handleTaskStatusChange(task.id, companyId, task.status, "done");
          db.addActivity({ companyId, actor: "board", action: "deliverable.approved", entityType: "task", entityId: task.id, detail: approval.decisionNote || "Deliverable approved by board." });
        } else if (decision === "rejected") {
          recordReviewFeedbackKnowledge(db, approval, decision);
          db.advanceTaskStatus(task.id, "in_progress", `Board rejected deliverable: ${approval.decisionNote || "No reason given."}`);
          handleTaskStatusChange(task.id, companyId, task.status, "in_progress");
          if (task.assigneeAgentId) {
            wakeAgentIfPossible(task.assigneeAgentId, companyId, "revision_needed");
          }
        } else if (decision === "revision_requested") {
          db.advanceTaskStatus(task.id, "in_progress", `Board requested revisions: ${approval.decisionNote || "No reason given."}`);
          handleTaskStatusChange(task.id, companyId, task.status, "in_progress");
          recordReviewFeedbackKnowledge(db, approval, decision);
          if (task.assigneeAgentId) {
            wakeAgentIfPossible(task.assigneeAgentId, companyId, "revision_needed");
          }
        }
      } else if (approval.requestedByAgentId) {
        // Document-only review (no task) — resume the producing agent
        try {
          const agent = db.getAgent(approval.requestedByAgentId);
          if (!agent.heartbeatEnabled) {
            db.setHeartbeat(approval.requestedByAgentId, true, agent.heartbeatIntervalSec || 120);
            logger.info(`[deliverable-review] Resumed heartbeat for ${agent.name} after user ${decision}.`);
          }
        } catch { /* agent lookup non-fatal */ }
        if (decision !== "approved") {
          wakeAgentIfPossible(approval.requestedByAgentId, companyId, "revision_needed");
        }
      }

      publishDomainChanged();
    } catch {
      // Deliverable review follow-up is non-fatal — approval state is already committed.
    }
  }

  if (approval.type === "draft_review" || approval.type === "strategy_review") {
    try {
      const documentIds = extractApprovalDocumentIds(approval.payloadJson);
      const docStatus = decision === "approved" ? "approved" : "draft";
      for (const docId of documentIds) {
        db.updateDocumentStatus(docId, companyId, docStatus);
      }
      publishDomainChanged();
    } catch {
      // Document checkpoint follow-up is non-fatal — approval state is already committed.
    }
  }

  // Handle budget override approvals
  if (approval.type === "budget_override" && decision === "approved") {
    try {
      const payload = JSON.parse(approval.payloadJson ?? "{}") as {
        policyId?: string;
        scopeType?: string;
        scopeId?: string;
        newAmount?: number;
      };
      if (payload.policyId) {
        // Resolve the budget incident that triggered this approval
        db.resolveBudgetIncident(payload.policyId, companyId);
        db.addActivity({
          companyId,
          actor: "board",
          action: "budget.override_approved",
          entityType: "approval",
          entityId: approvalId,
          detail: `Budget override approved for ${payload.scopeType} scope`,
        });
      }
    } catch (err) {
      logger.error(`[automation] Failed to process budget_override approval: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const browserAction = db.getBrowserActionByApprovalId(approvalId, companyId);
  if (browserAction) {
    if (decision === "approved") {
      db.updateBrowserAction(browserAction.id, {
        status: "queued",
        resultSummary: "Approval granted. Dispatching browser action.",
        errorMessage: null,
      });
      publishDomainChanged();
      void dispatchBrowserAction(browserAction.id, companyId).catch((error) => {
        logger.error(`[browser] Failed to dispatch approved browser action ${browserAction.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    } else if (decision === "rejected") {
      db.updateBrowserAction(browserAction.id, {
        status: "cancelled",
        resultSummary: "Browser action was rejected during approval.",
        errorMessage: "Approval rejected by board.",
        finishedAt: new Date().toISOString(),
      });
      publishDomainChanged();
    } else if (decision === "revision_requested") {
      db.updateBrowserAction(browserAction.id, {
        status: "approval_required",
        resultSummary: "Board requested revisions before execution.",
        errorMessage: "Approval requires revisions before the browser action can run.",
      });
      publishDomainChanged();
    }
  }

  if (approval.type === "social_post" && decision === "approved" && approval.payloadJson) {
    try {
      const draft = JSON.parse(approval.payloadJson) as {
        socialAccountId: string;
        platform: string;
        content: string;
        mediaUrls: string[];
        scheduledAt: string | null;
      };

      const dispatchSocialAction = () => {
        const actionId = db.saveBrowserAction({
          companyId: approval.companyId,
          socialAccountId: draft.socialAccountId,
          agentId: approval.requestedByAgentId ?? "",
          actionType: "post",
          payloadJson: JSON.stringify({ content: draft.content, mediaUrls: draft.mediaUrls, scheduledAt: draft.scheduledAt }),
          status: "queued",
          approvalId: approval.id,
        });
        publishDomainChanged();
        void dispatchBrowserAction(actionId, approval.companyId).catch((error) => {
          logger.error(`[automation] Failed to dispatch approved social post ${actionId}: ${error instanceof Error ? error.message : String(error)}`);
        });
      };

      if (draft.scheduledAt) {
        const delay = new Date(draft.scheduledAt).getTime() - Date.now();
        if (delay > 0) {
          const timer = setTimeout(() => {
            if (deps.isQuitting()) return;
            dispatchSocialAction();
          }, delay);
          trackTimer(timer);
        } else {
          dispatchSocialAction();
        }
      } else {
        dispatchSocialAction();
      }
    } catch (err) {
      logger.error("[automation] Failed to dispatch approved social post:", err);
    }
  }

  // Workflow-step approvals are emitted by runWorkflowPipeline with
  // type "dangerous_command" + workflowId/stepId in payloadJson. Gate the
  // parse explicitly on that type instead of attempting a speculative
  // JSON.parse for every approval.
  if (approval.type === "dangerous_command" && approval.payloadJson) {
    const payload = workflowApprovalPayloadSchema.safeParse(JSON.parse(approval.payloadJson));
    if (payload.success && payload.data.workflowId && payload.data.stepId) {
      const { workflowId, stepId } = payload.data;
      const workflow = db.getWorkflowRecord(workflowId, companyId);
      if (workflow) {
        const steps = normalizeWorkflowSteps(JSON.parse(workflow.stepsJson || "[]"));
        const stepIndex = steps.findIndex((step) => step.id === stepId);
        if (stepIndex >= 0) {
          if (decision === "approved") {
            steps[stepIndex]!.status = "pending";
            db.updateWorkflowExecution({
              id: workflow.id,
              companyId,
              status: "paused",
              currentStepIndex: stepIndex,
              stepsJson: JSON.stringify(steps),
              lastRunAt: workflow.lastRunAt,
            });
            publishDomainChanged();
            void runWorkflowPipeline(workflow.id, companyId).catch((error) => {
              logger.error(`[workflow] Failed to resume workflow ${workflow.id} after approval ${approvalId}: ${error instanceof Error ? error.message : String(error)}`);
            });
          } else {
            steps[stepIndex]!.status = decision === "revision_requested" ? "pending" : "failed";
            db.updateWorkflowExecution({
              id: workflow.id,
              companyId,
              status: decision === "revision_requested" ? "paused" : "failed",
              currentStepIndex: stepIndex,
              stepsJson: JSON.stringify(steps),
              lastRunAt: workflow.lastRunAt,
            });
            publishDomainChanged();
          }
        }
      }
    }
  }

  if (approval.requestedByAgentId) {
    wakeAgentIfPossible(approval.requestedByAgentId, companyId, "approval_resolved");
  }
}
