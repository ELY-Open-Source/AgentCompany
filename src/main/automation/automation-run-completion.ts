import type { AppDatabase } from "../database";
import type { RunRecord } from "@shared/types";
import type { NotificationOptions } from "../notification-service";
import type { AutomationEventContext, RunFinishedEvent } from "./types";
import { IMPORTANT_DOCUMENT_TYPES } from "./types";

function localizeNotification(locale: string | null | undefined, en: string, zh: string): string {
  return locale === "zh" ? zh : en;
}

export interface RunCompletionDeps {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  publishDomainChanged: () => void;
  notify: (options: NotificationOptions) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
}

export interface RunCompletionCallbacks {
  dispatchAutomation: (trigger: string, ctx: AutomationEventContext) => void;
  handleTaskStatusChange: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => void;
}

function checkRunProducedDeliverable(db: AppDatabase, runId: string, companyId: string, taskId: string): boolean {
  // Prefer causal binding via source_run_id (set when document/knowledge
  // is created during a run). Falls back to time-window for legacy data
  // that predates the source_run_id column.
  const causalKnowledge = db.queryAll<{ id: string }>(
    "select id from knowledge_base where company_id = ? and source_run_id = ? limit 1",
    companyId, runId,
  );
  if (causalKnowledge.length > 0) return true;

  const causalDocs = db.queryAll<{ id: string }>(
    "select id from documents where company_id = ? and source_run_id = ? limit 1",
    companyId, runId,
  );
  if (causalDocs.length > 0) return true;

  // Time-window fallback: check for legacy records without source_run_id
  const legacyKnowledge = db.queryAll<{ id: string }>(
    "select id from knowledge_base where company_id = ? and source_run_id is null and created_at >= (select started_at from runs where id = ?) limit 1",
    companyId, runId,
  );
  if (legacyKnowledge.length > 0) return true;

  const legacyDocs = db.queryAll<{ id: string }>(
    "select id from documents where company_id = ? and source_run_id is null and created_at >= (select started_at from runs where id = ?) limit 1",
    companyId, runId,
  );
  if (legacyDocs.length > 0) return true;

  const recentComments = db.queryAll<{ body: string }>(
    "select body from task_comments where task_id = ? and created_at >= (select started_at from runs where id = ?) and length(body) > 100",
    taskId, runId,
  );
  if (recentComments.length > 0) return true;

  return false;
}

/** Returns important documents created during this run (matching IMPORTANT_DOCUMENT_TYPES). */
function findImportantDocsForRun(db: AppDatabase, runId: string, companyId: string): Array<{ id: string; type: string; title: string }> {
  const placeholders = [...IMPORTANT_DOCUMENT_TYPES].map(() => "?").join(", ");
  // Prefer causal binding, fall back to time-window for legacy data
  const causal = db.queryAll<{ id: string; type: string; title: string }>(
    `select id, type, title from documents where company_id = ? and type in (${placeholders}) and source_run_id = ?`,
    companyId, ...IMPORTANT_DOCUMENT_TYPES, runId,
  );
  if (causal.length > 0) return causal;
  return db.queryAll<{ id: string; type: string; title: string }>(
    `select id, type, title from documents where company_id = ? and type in (${placeholders}) and source_run_id is null and created_at >= (select started_at from runs where id = ?)`,
    companyId, ...IMPORTANT_DOCUMENT_TYPES, runId,
  );
}

/** Creates a deliverable_review approval and fires OS notification. */
function createDeliverableReviewApproval(
  deps: RunCompletionDeps,
  companyId: string,
  taskId: string,
  agentId: string,
  docs: Array<{ id: string; type: string; title: string }>,
  reviewerNote?: string,
): string {
  const { db, logger, publishDomainChanged, notify } = deps;
  const docTitles = docs.map((d) => d.title).join(", ");
  const approvalId = db.requestApproval({
    companyId,
    relatedTaskId: taskId,
    requestedByAgentId: agentId,
    type: "deliverable_review",
    payloadSummary: `Review deliverable: ${docTitles}`.slice(0, 280),
    impactSummary: reviewerNote ?? "Agent completed work with important deliverables. Awaiting your final review.",
    payloadJson: JSON.stringify({ documentIds: docs.map((d) => d.id), documents: docs }),
  });
  db.setTaskRequiresUserReview(taskId, false);
  const agent = db.getAgent(agentId);
  if (agent.heartbeatEnabled) {
    db.setHeartbeat(agentId, false, agent.heartbeatIntervalSec || 120);
    logger.info(`[deliverable-review] Paused heartbeat for ${agent.name} — awaiting user review.`);
  }
  notify({
    title: "Deliverable Ready for Review",
    body: `${docTitles}`.slice(0, 200),
    urgency: "informational",
    navigation: { section: "approvals", entityId: approvalId },
    batchKey: "deliverable_review",
  });
  publishDomainChanged();
  return approvalId;
}

export function processRunCompletion(
  deps: RunCompletionDeps,
  callbacks: RunCompletionCallbacks,
  run: RunRecord,
  event: RunFinishedEvent,
  isQuitting: () => boolean,
): void {
  if (isQuitting()) return;
  const { db, logger, publishDomainChanged, notify, wakeAgentIfPossible } = deps;
  const { dispatchAutomation, handleTaskStatusChange } = callbacks;

  let task: ReturnType<typeof db.getTask> | null = null;
  try {
    task = db.getTask(run.taskId);
  } catch {
    return;
  }
  if (!task) return;

  const isSuccess = event.status === "succeeded";
  const isFailed = event.status === "failed" || event.status === "timed_out";

  let effectiveStatus = task.status;

  if (isSuccess && effectiveStatus === "in_progress") {
    // Check if non-code task produced a deliverable before auto-advancing
    const taskType = ((task as unknown as Record<string, unknown>).task_type as string) ?? "general";
    const needsDeliverable = taskType === "research" || taskType === "content";

    if (needsDeliverable) {
      const hasDeliverable = checkRunProducedDeliverable(db, run.id, run.companyId, task.id);
      if (!hasDeliverable) {
        // Don't auto-advance -- flag for manager review
        db.advanceTaskStatus(task.id, "in_progress",
          `${taskType} task run completed but no deliverable artifact was detected. Flagging for manager review.`);
        handleTaskStatusChange(task.id, run.companyId, "in_progress", "in_progress");
        // Wake manager for review
        try {
          const agent = db.getAgent(run.agentId);
          const chain = db.getChainOfCommand(agent.id);
          if (chain.length > 0) {
            wakeAgentIfPossible(chain[0].id, run.companyId, "review_needed");
          }
        } catch { /* best effort */ }
        publishDomainChanged();
        // Skip the normal in_review advance
      } else {
        db.advanceTaskStatus(task.id, "in_review", "Run completed with deliverable. Awaiting review.");
        handleTaskStatusChange(task.id, run.companyId, "in_progress", "in_review");
        effectiveStatus = "in_review";
        const company = db.listSnapshot().companies.find((c) => c.id === run.companyId);
        if (company?.reviewDeliverables) {
          const importantDocs = findImportantDocsForRun(db, run.id, run.companyId);
          if (importantDocs.length > 0) {
            db.setTaskRequiresUserReview(task.id, true);
            const agent = db.getAgent(run.agentId);
            if (agent.heartbeatEnabled) {
              db.setHeartbeat(agent.id, false, agent.heartbeatIntervalSec || 120);
              logger.info(`[deliverable-review] Paused heartbeat for ${agent.name} — deliverable flagged for review.`);
            }
            const chain = db.getChainOfCommand(agent.id);
            if (chain.length === 0) {
              createDeliverableReviewApproval(deps, run.companyId, task.id, run.agentId, importantDocs);
            }
          }
        }
        publishDomainChanged();
      }
    } else {
      // Code/management/general tasks advance normally
      db.advanceTaskStatus(task.id, "in_review", "Run completed successfully. Awaiting review.");
      handleTaskStatusChange(task.id, run.companyId, "in_progress", "in_review");
      effectiveStatus = "in_review";
      const company = db.listSnapshot().companies.find((c) => c.id === run.companyId);
      if (company?.reviewDeliverables) {
        const importantDocs = findImportantDocsForRun(db, run.id, run.companyId);
        if (importantDocs.length > 0) {
          db.setTaskRequiresUserReview(task.id, true);
          const agent = db.getAgent(run.agentId);
          if (agent.heartbeatEnabled) {
            db.setHeartbeat(agent.id, false, agent.heartbeatIntervalSec || 120);
            logger.info(`[deliverable-review] Paused heartbeat for ${agent.name} — deliverable flagged for review.`);
          }
          const chain = db.getChainOfCommand(agent.id);
          if (chain.length === 0) {
            createDeliverableReviewApproval(deps, run.companyId, task.id, run.agentId, importantDocs);
          }
        }
      }
      publishDomainChanged();
    }
  }

  if (isSuccess && task.title.startsWith("[Heartbeat]") && effectiveStatus !== "done") {
    db.advanceTaskStatus(task.id, "done", "Heartbeat check completed.");
    handleTaskStatusChange(task.id, run.companyId, effectiveStatus, "done");
  }

  const automationContext: AutomationEventContext = {
    companyId: run.companyId,
    taskId: run.taskId,
    agentId: run.agentId,
    runId: run.id,
    costUsd: event.costUsd ?? undefined,
  };
  try {
    const agent = db.getAgent(run.agentId);
    automationContext.department = agent.department ?? undefined;
  } catch {
    // Agent can disappear after a run completes; keep the context without department.
  }

  if (isSuccess) {
    dispatchAutomation("run_completed", automationContext);
    if (task.parentId) {
      try {
        const siblings = db.listChildTasks(task.parentId, run.companyId);
        const allSiblingsDoneOrReview = siblings.every((entry) => entry.status === "done" || entry.status === "in_review");
        if (allSiblingsDoneOrReview) {
          const parent = db.getTask(task.parentId);
          if (parent.assigneeAgentId) {
            wakeAgentIfPossible(parent.assigneeAgentId, run.companyId, "subtask_completed");
          } else {
            const assignedId = db.autoAssignTask(parent.id, run.companyId);
            if (assignedId) {
              wakeAgentIfPossible(assignedId, run.companyId, "subtask_completed");
            }
          }
        }
      } catch {
        // Parent task may have been deleted or reassigned during cascade evaluation.
      }
    }
  }

  if (isFailed) {
    dispatchAutomation("run_failed", automationContext);
  }

  if (event.costUsd && event.costUsd > 0) {
    try {
      const agent = db.getAgent(run.agentId);
      if (agent.budgetMonthlyUsd > 0) {
        const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
        if (utilization >= 0.8) {
          dispatchAutomation("budget_threshold", {
            ...automationContext,
            agentId: agent.id,
          });
          // Fire OS notification for budget threshold warning
          const pct = Math.round(utilization * 100);
          const budgetLocale = db.listSnapshot().locale;
          notify({
            title: localizeNotification(budgetLocale, "Budget Warning", "预算警告"),
            body: localizeNotification(budgetLocale, `${agent.name} has used ${pct}% of monthly budget`, `${agent.name} 已使用月度预算的 ${pct}%`),
            urgency: "informational",
            navigation: { section: "costs" },
            batchKey: "budget_alerts",
          });
          if (utilization >= 1.0) {
            // Fire OS notification for budget exhaustion (agent auto-paused by database)
            notify({
              title: localizeNotification(budgetLocale, "Budget Exhausted", "预算耗尽"),
              body: localizeNotification(budgetLocale, `${agent.name} has reached 100% of monthly budget and is paused`, `${agent.name} 已达到月度预算上限并已暂停`),
              urgency: "critical",
              navigation: { section: "costs" },
            });
          }
        }
      }
    } catch {
      // Budget follow-up is best-effort; do not fail run completion if the agent disappeared.
    }
  }
}
