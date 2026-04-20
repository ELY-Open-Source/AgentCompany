import { z } from "zod";
import type { AppDatabase } from "../database";
import type { NotificationOptions } from "../notification-service";
import { extractApprovalDocumentIds } from "@shared/approval-documents";
import { notifyHireApproved } from "../hire-hook";
import { autoAssignSkillsForHire } from "../skills/auto-assign-on-hire";
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

  const task = db.entityCrud.getTask(approval.relatedTaskId);
  const feedback = approval.decisionNote?.trim() || "Board requested revisions before approval.";
  const topic = `Review feedback: ${task.title}`;
  const content = [
    `Decision: ${decision}`,
    `Feedback: ${feedback}`,
    "Use this review guidance to improve future deliverables for similar work.",
  ].join("\n");

  db.knowledgeMod.saveKnowledgeEntry({
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

  const snapshot = db.snap.listSnapshot();
  const approval = snapshot.approvals.find((entry) => entry.id === approvalId);
  if (!approval) return;

  dispatchAutomation("approval_resolved", {
    companyId,
    agentId: approval.requestedByAgentId ?? undefined,
    taskId: approval.relatedTaskId ?? undefined,
  });

  if (approval.type === "hire_agent" && decision === "approved" && approval.relatedAgentId) {
    const agent = db.entityCrud.getAgent(approval.relatedAgentId);

    if (agent.status === "idle") {
      // Deterministic default skill kit. The CEO's operating prompt
      // used to carry this responsibility ("ensure every direct report
      // has skills"), turning O(reports) API calls into a per-wake
      // tax. At hire approval time we know the agent's department and
      // the company's seeded catalogue — assign the default bundle so
      // the new hire's first run already has the right SKILL.md
      // manifest.
      const { assignedSkillIds } = autoAssignSkillsForHire(db, {
        agentId: agent.id,
        companyId,
        department: agent.department,
      });
      if (assignedSkillIds.length > 0) {
        db.activityMod.addActivity({
          companyId,
          actor: "system",
          action: "agent.skills_defaulted",
          entityType: "agent",
          entityId: agent.id,
          detail: `${assignedSkillIds.length} default skill(s) assigned on hire.`,
        });
      }

      db.activityMod.addActivity({
        companyId,
        actor: "system",
        action: "agent.hired",
        entityType: "agent",
        entityId: agent.id,
        detail: `${agent.name} hire approved and activated.`,
      });

      dispatchAutomation("hire_approved", {
        companyId,
        agentId: agent.id,
      });
      wakeAgentIfPossible(agent.id, companyId, "assignment");

      const ceo = db.agents.getCeoForCompany(companyId);
      if (ceo && ceo.id !== agent.id) {
        wakeAgentIfPossible(ceo.id, companyId, "assignment");
      }

      publishDomainChanged();
      const hireLocale = db.snap.listSnapshot().locale;
      notify({
        title: localizeNotification(hireLocale, "Agent Hired", "新员工入职"),
        body: localizeNotification(hireLocale, `${agent.name} joined as ${agent.role}`, `${agent.name} 已加入，职位：${agent.role}`),
        urgency: "informational",
        navigation: { section: "agents", entityId: agent.id },
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
  }

  if (approval.type === "deliverable_review") {
    const documentIds = extractApprovalDocumentIds(approval.payloadJson);
    const docStatus = decision === "approved"
      ? "approved"
      : decision === "rejected" || decision === "revision_requested"
        ? "draft"
        : "in_review";
    for (const docId of documentIds) {
      db.documentsMod.updateDocumentStatus(docId, companyId, docStatus);
    }

    if (approval.relatedTaskId) {
      const task = db.entityCrud.getTask(approval.relatedTaskId);
      if (task.assigneeAgentId) {
        const agent = db.entityCrud.getAgent(task.assigneeAgentId);
        if (!agent.heartbeatEnabled) {
          db.agents.setHeartbeat(task.assigneeAgentId, true, agent.heartbeatIntervalSec || 120);
          logger.info(`[deliverable-review] Resumed heartbeat for ${agent.name} after user ${decision}.`);
        }
      }
      if (decision === "approved") {
        db.tasks.advanceTaskStatus(task.id, "done", "Board approved deliverable.");
        handleTaskStatusChange(task.id, companyId, task.status, "done");
        db.activityMod.addActivity({ companyId, actor: "board", action: "deliverable.approved", entityType: "task", entityId: task.id, detail: approval.decisionNote || "Deliverable approved by board." });
      } else if (decision === "rejected") {
        recordReviewFeedbackKnowledge(db, approval, decision);
        db.tasks.advanceTaskStatus(task.id, "in_progress", `Board rejected deliverable: ${approval.decisionNote || "No reason given."}`);
        handleTaskStatusChange(task.id, companyId, task.status, "in_progress");
        if (task.assigneeAgentId) {
          wakeAgentIfPossible(task.assigneeAgentId, companyId, "revision_needed");
        }
      } else if (decision === "revision_requested") {
        db.tasks.advanceTaskStatus(task.id, "in_progress", `Board requested revisions: ${approval.decisionNote || "No reason given."}`);
        handleTaskStatusChange(task.id, companyId, task.status, "in_progress");
        recordReviewFeedbackKnowledge(db, approval, decision);
        if (task.assigneeAgentId) {
          wakeAgentIfPossible(task.assigneeAgentId, companyId, "revision_needed");
        }
      }
    } else if (approval.requestedByAgentId) {
      const agent = db.entityCrud.getAgent(approval.requestedByAgentId);
      if (!agent.heartbeatEnabled) {
        db.agents.setHeartbeat(approval.requestedByAgentId, true, agent.heartbeatIntervalSec || 120);
        logger.info(`[deliverable-review] Resumed heartbeat for ${agent.name} after user ${decision}.`);
      }
      if (decision !== "approved") {
        wakeAgentIfPossible(approval.requestedByAgentId, companyId, "revision_needed");
      }
    }

    publishDomainChanged();
  }

  if (approval.type === "draft_review" || approval.type === "strategy_review") {
    const documentIds = extractApprovalDocumentIds(approval.payloadJson);
    const docStatus = decision === "approved" ? "approved" : "draft";
    for (const docId of documentIds) {
      db.documentsMod.updateDocumentStatus(docId, companyId, docStatus);
    }
    publishDomainChanged();
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
        db.budget.resolveBudgetIncident(payload.policyId, companyId);
        db.activityMod.addActivity({
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

  const browserAction = db.social.getBrowserActionByApprovalId(approvalId, companyId);
  if (browserAction) {
    if (decision === "approved") {
      db.social.updateBrowserAction(browserAction.id, {
        status: "queued",
        resultSummary: "Approval granted. Dispatching browser action.",
        errorMessage: null,
      });
      publishDomainChanged();
      void dispatchBrowserAction(browserAction.id, companyId).catch((error) => {
        logger.error(`[browser] Failed to dispatch approved browser action ${browserAction.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    } else if (decision === "rejected") {
      db.social.updateBrowserAction(browserAction.id, {
        status: "cancelled",
        resultSummary: "Browser action was rejected during approval.",
        errorMessage: "Approval rejected by board.",
        finishedAt: new Date().toISOString(),
      });
      publishDomainChanged();
    } else if (decision === "revision_requested") {
      db.social.updateBrowserAction(browserAction.id, {
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
        const actionId = db.social.saveBrowserAction({
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
      const workflow = db.automationMod.getWorkflowRecord(workflowId, companyId);
      if (workflow) {
        const steps = normalizeWorkflowSteps(JSON.parse(workflow.stepsJson || "[]"));
        const stepIndex = steps.findIndex((step) => step.id === stepId);
        if (stepIndex >= 0) {
          if (decision === "approved") {
            steps[stepIndex]!.status = "pending";
            db.automationMod.updateWorkflowExecution({
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
            db.automationMod.updateWorkflowExecution({
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
