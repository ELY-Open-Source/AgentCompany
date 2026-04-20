import type { AppDatabase } from "../database";
import type { RunRecord, SectionId } from "@shared/types";
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

// ─── Pure helpers exported for testing ─────────────────────────────────────

export type DeliverableTaskType = "code" | "research" | "content" | "management" | "general";

/** Returns true for task types that require a tangible artifact before auto-advancing. */
export function needsDeliverableCheck(taskType: DeliverableTaskType | string): boolean {
  return taskType === "research" || taskType === "content";
}

export interface DeliverableSignals {
  hasKnowledgeEntry: boolean;
  hasDocument: boolean;
  hasWorkProduct: boolean;
  hasSubstantialComment: boolean;
}

export interface DeliverableCheckInput extends DeliverableSignals {
  taskType: DeliverableTaskType | string;
}

/**
 * Valid artifact surfaces for each task type. A task advances to review
 * only when at least one signal from the set is present. The `work_product`
 * surface covers filesystem deliverables the agent writes via bash / write
 * / edit; before this table included it, a research task that produced a
 * markdown file instead of a knowledge entry would stay in `in_progress`
 * forever even though the deliverable was sitting on disk.
 */
const VALID_DELIVERABLE_SIGNALS: Record<DeliverableTaskType, ReadonlySet<keyof DeliverableSignals>> = {
  research: new Set(["hasKnowledgeEntry", "hasDocument", "hasWorkProduct", "hasSubstantialComment"]),
  content: new Set(["hasDocument", "hasWorkProduct"]),
  code: new Set(["hasWorkProduct", "hasDocument"]),
  management: new Set(["hasKnowledgeEntry", "hasDocument", "hasWorkProduct", "hasSubstantialComment"]),
  general: new Set(["hasKnowledgeEntry", "hasDocument", "hasWorkProduct", "hasSubstantialComment"]),
};

function validSignalsForTaskType(taskType: string): ReadonlySet<keyof DeliverableSignals> {
  return VALID_DELIVERABLE_SIGNALS[taskType as DeliverableTaskType]
    ?? VALID_DELIVERABLE_SIGNALS.general;
}

export function hasValidDeliverableFor(taskType: string, signals: DeliverableSignals): boolean {
  const valid = validSignalsForTaskType(taskType);
  for (const key of valid) {
    if (signals[key]) return true;
  }
  return false;
}

/** Returns the next task status and comment after a successful run. */
export function determinePostRunStatus(input: DeliverableCheckInput): {
  nextStatus: "in_review" | "in_progress";
  comment: string;
} {
  if (!needsDeliverableCheck(input.taskType)) {
    return {
      nextStatus: "in_review",
      comment: "Run completed successfully. Awaiting review.",
    };
  }
  if (hasValidDeliverableFor(input.taskType, input)) {
    return {
      nextStatus: "in_review",
      comment: "Run completed with deliverable. Awaiting review.",
    };
  }
  return {
    nextStatus: "in_progress",
    comment: `${input.taskType} task run completed but no deliverable artifact was detected. Flagging for manager review.`,
  };
}

export interface BudgetThresholdInput {
  name: string;
  budgetMonthlyUsd: number;
  spentMonthlyUsd: number;
}

/**
 * Fires budget threshold notifications when utilization >= 80%.
 * The notify callback receives a NotificationOptions-style object so callers
 * can forward it directly to the notification service.
 */
export function checkBudgetThreshold(
  agent: BudgetThresholdInput,
  notify: (opts: { title: string; body: string; urgency: "critical" | "informational"; navigation: { section: SectionId }; batchKey?: string }) => void,
  localizeNotification: (en: string, zh: string) => string,
): void {
  if (agent.budgetMonthlyUsd <= 0) return;
  const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
  if (utilization < 0.8) return;

  const pct = Math.round(utilization * 100);
  notify({
    title: localizeNotification("Budget Warning", "预算警告"),
    body: localizeNotification(
      `${agent.name} has used ${pct}% of monthly budget`,
      `${agent.name} 已使用月度预算的 ${pct}%`,
    ),
    urgency: "informational",
    navigation: { section: "costs" },
    batchKey: "budget_alerts",
  });

  if (utilization >= 1.0) {
    notify({
      title: localizeNotification("Budget Exhausted", "预算耗尽"),
      body: localizeNotification(
        `${agent.name} has reached 100% of monthly budget and is paused`,
        `${agent.name} 已达到月度预算上限并已暂停`,
      ),
      urgency: "critical",
      navigation: { section: "costs" },
    });
  }
}

// ─── Internal DB-backed deliverable check ───────────────────────────────────

function checkRunProducedDeliverable(
  db: AppDatabase,
  runId: string,
  companyId: string,
  taskId: string,
  taskType: string,
): boolean {
  const signals = db.knowledgeMod.collectRunDeliverableSignals(runId, companyId, taskId);
  return hasValidDeliverableFor(taskType, signals);
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
  const approvalId = db.approvalsMod.requestApproval({
    companyId,
    relatedTaskId: taskId,
    requestedByAgentId: agentId,
    type: "deliverable_review",
    payloadSummary: `Review deliverable: ${docTitles}`.slice(0, 280),
    impactSummary: reviewerNote ?? "Agent completed work with important deliverables. Awaiting your final review.",
    payloadJson: JSON.stringify({ documentIds: docs.map((d) => d.id), documents: docs }),
  });
  db.tasks.setTaskRequiresUserReview(taskId, false);
  const agent = db.entityCrud.getAgent(agentId);
  if (agent.heartbeatEnabled) {
    db.agents.setHeartbeat(agentId, false, agent.heartbeatIntervalSec || 120);
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

/**
 * Decide the terminal status a successful run should leave the task in.
 *
 * `in_review` only makes sense when there is a reachable reviewer:
 *   - a non-top-level assignee always has a manager who reviews;
 *   - in `ai_cofounder` mode the human is the implicit reviewer;
 *   - in `ai_ceo` mode the operator opted out of human review, but
 *     they can re-opt-in per company via `reviewDeliverables`.
 *
 * Top-level agents in `ai_ceo` mode without `reviewDeliverables` have
 * no reviewer — neither a manager to walk up to nor a human gate.
 * Routing them through `in_review` strands the task forever (the
 * heartbeat candidate filter only picks `todo / in_progress / blocked`
 * so the CEO never sees its own stuck rows) and the codebase's old
 * workaround was to force-flag `requires_user_review` so the
 * `guardInReviewHasReviewer` would let the transition through. That
 * was paper over the symptom; the right answer is to skip review
 * entirely and advance straight to `done`.
 */
function decideTerminalStatus(
  db: RunCompletionDeps["db"],
  agent: ReturnType<RunCompletionDeps["db"]["entityCrud"]["getAgent"]>,
  companyId: string,
): "in_review" | "done" {
  if (agent.reportsTo !== null) return "in_review";
  const mode = db.company.getCompanyExecutionMode(companyId);
  if (mode !== "ai_ceo") return "in_review";
  const settings = db.company.getCompanyApprovalSettings(companyId);
  return settings?.reviewDeliverables ? "in_review" : "done";
}

/** Auto-resolves the task as a successful autonomous completion. */
function advanceToDone(
  deps: RunCompletionDeps,
  callbacks: RunCompletionCallbacks,
  run: RunRecord,
  taskId: string,
  statusMessage: string,
): void {
  const { db, publishDomainChanged } = deps;
  db.tasks.advanceTaskStatus(taskId, "done", statusMessage);
  callbacks.handleTaskStatusChange(taskId, run.companyId, "in_progress", "done");
  publishDomainChanged();
}

/** Advances a task to in_review and optionally flags deliverables for user review. */
function advanceToInReview(
  deps: RunCompletionDeps,
  callbacks: RunCompletionCallbacks,
  run: RunRecord,
  taskId: string,
  statusMessage: string,
): void {
  const { db, logger, publishDomainChanged } = deps;
  // The tasks-status guard refuses an `in_review` transition for a
  // top-level assignee (reports_to IS NULL) unless the task is
  // flagged for user review. The caller (`processRunCompletion`) only
  // routes top-level runs through this helper when human review is
  // expected (`ai_cofounder` mode or `reviewDeliverables = true`), so
  // pre-flagging here is the right semantics — the human IS the
  // reviewer in those configurations.
  const agent = db.entityCrud.getAgent(run.agentId);
  if (agent.reportsTo === null) {
    db.tasks.setTaskRequiresUserReview(taskId, true);
  }
  db.tasks.advanceTaskStatus(taskId, "in_review", statusMessage);
  callbacks.handleTaskStatusChange(taskId, run.companyId, "in_progress", "in_review");
  const company = db.snap.listSnapshot().companies.find((c) => c.id === run.companyId);
  if (company?.reviewDeliverables) {
    const importantDocs = findImportantDocsForRun(db, run.id, run.companyId);
    if (importantDocs.length > 0) {
      db.tasks.setTaskRequiresUserReview(taskId, true);
      if (agent.heartbeatEnabled) {
        db.agents.setHeartbeat(agent.id, false, agent.heartbeatIntervalSec || 120);
        logger.info(`[deliverable-review] Paused heartbeat for ${agent.name} — deliverable flagged for review.`);
      }
      const chain = db.agents.getChainOfCommand(agent.id);
      if (chain.length === 0) {
        createDeliverableReviewApproval(deps, run.companyId, taskId, run.agentId, importantDocs);
      }
    }
  }
  publishDomainChanged();
}

/**
 * Pick the right terminal-status helper for this run. `processRunCompletion`
 * uses it after every successful "produced something or didn't need to"
 * branch; `decideTerminalStatus` is the single source of truth that says
 * `done` (no reviewer needed) vs `in_review` (reviewer expected).
 */
function advanceSuccessfulRun(
  deps: RunCompletionDeps,
  callbacks: RunCompletionCallbacks,
  run: RunRecord,
  taskId: string,
  statusMessage: string,
): "in_review" | "done" {
  const agent = deps.db.entityCrud.getAgent(run.agentId);
  const target = decideTerminalStatus(deps.db, agent, run.companyId);
  if (target === "done") {
    advanceToDone(deps, callbacks, run, taskId, statusMessage);
  } else {
    advanceToInReview(deps, callbacks, run, taskId, statusMessage);
  }
  return target;
}

export function processRunCompletion(
  deps: RunCompletionDeps,
  callbacks: RunCompletionCallbacks,
  run: RunRecord,
  event: RunFinishedEvent,
  isQuitting: () => boolean,
): void {
  if (isQuitting()) return;
  const { db, logger: _logger, publishDomainChanged, notify, wakeAgentIfPossible } = deps;
  const { dispatchAutomation, handleTaskStatusChange } = callbacks;

  if (!run.taskId) return;
  let task: ReturnType<typeof db.entityCrud.getTask> | null = null;
  try {
    task = db.entityCrud.getTask(run.taskId);
  } catch (error) {
    deps.logger.warn(`[automation] processRunCompletion: task ${run.taskId} not found for run ${run.id}:`, error);
    return;
  }
  if (!task) return;

  const isSuccess = event.status === "succeeded";
  const isFailed = event.status === "failed" || event.status === "timed_out";

  let effectiveStatus = task.status;

  if (isSuccess && effectiveStatus === "in_progress") {
    // Delegate the task-type → deliverable-required decision to the pure
    // helper so production and tests share a single source of truth.
    const taskType = task.taskType ?? "general";

    if (needsDeliverableCheck(taskType)) {
      const hasDeliverable = checkRunProducedDeliverable(db, run.id, run.companyId, task.id, taskType);
      if (!hasDeliverable) {
        // Don't auto-advance to in_review: the run succeeded but did not
        // produce the required deliverable, so it's not ready for
        // manager sign-off.
        //
        // Park the task as `blocked` rather than leaving it at
        // `in_progress`. finishRun has already cleared the run's
        // checkout_run_id and active_run_id, so a task still tagged
        // `in_progress` has no lock, no run, and no path back to
        // `todo` — heartbeat picks it up, checkoutTask rejects it
        // (status ∉ todo/backlog), and the assignee is stuck in a
        // permanent `checkout_race_lost` loop. Blocking instead puts
        // the task in the manager's blocker queue with the diagnostic
        // comment attached; the manager patches it back to `todo` (or
        // `cancelled`) after deciding how to proceed.
        db.tasks.advanceTaskStatus(
          task.id,
          "blocked",
          `${taskType} task run completed but no deliverable artifact was detected. Flagging for manager review.`,
        );
        handleTaskStatusChange(task.id, run.companyId, "in_progress", "blocked");
        // Wake manager for review
        try {
          const agent = db.entityCrud.getAgent(run.agentId);
          const chain = db.agents.getChainOfCommand(agent.id);
          if (chain.length > 0) {
            wakeAgentIfPossible(chain[0].id, run.companyId, "review_needed");
          }
        } catch (error) {
          deps.logger.warn(
            `[automation] deliverable-review manager wake failed for agent ${run.agentId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        publishDomainChanged();
        effectiveStatus = "blocked";
        // Skip the normal in_review advance
      } else {
        effectiveStatus = advanceSuccessfulRun(
          deps,
          callbacks,
          run,
          task.id,
          "Run completed with deliverable.",
        );
      }
    } else {
      // Code/management/general tasks: route through the same selector
      // so ai_ceo top-level completions land in `done` instead of
      // stalling in the `in_review` dead-letter.
      effectiveStatus = advanceSuccessfulRun(
        deps,
        callbacks,
        run,
        task.id,
        "Run completed successfully.",
      );
    }
  }

  const automationContext: AutomationEventContext = {
    companyId: run.companyId,
    taskId: run.taskId ?? undefined,
    agentId: run.agentId,
    runId: run.id,
  };
  try {
    const agent = db.entityCrud.getAgent(run.agentId);
    automationContext.department = agent.department ?? undefined;
  } catch (err) {
    deps.logger.warn(`[automation] getAgent failed for ${run.agentId} during run completion; dropping department from context:`, err instanceof Error ? err.message : String(err));
  }

  if (isSuccess) {
    dispatchAutomation("run_completed", automationContext);
    if (task.parentId) {
      try {
        const siblings = db.tasks.listChildTasks(task.parentId, run.companyId);
        const allSiblingsDoneOrReview = siblings.every((entry) => entry.status === "done" || entry.status === "in_review");
        if (allSiblingsDoneOrReview) {
          const parent = db.entityCrud.getTask(task.parentId);
          if (parent.assigneeAgentId) {
            wakeAgentIfPossible(parent.assigneeAgentId, run.companyId, "subtask_completed");
          } else {
            const assignedId = db.tasks.autoAssignTask(parent.id, run.companyId);
            if (assignedId) {
              wakeAgentIfPossible(assignedId, run.companyId, "subtask_completed");
            }
          }
        }
      } catch (err) {
        deps.logger.warn(`[automation] Parent task ${task.parentId} cascade failed during run completion:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (isFailed) {
    dispatchAutomation("run_failed", automationContext);
  }

  // Budget threshold check runs after every succeeded run; finishRun
  // has already summed cost_entries and updated spentMonthlyUsd, so we
  // just read the post-run spend and fire if it crosses 80%.
  if (isSuccess) {
    try {
      const agent = db.entityCrud.getAgent(run.agentId);
      if (agent.budgetMonthlyUsd > 0) {
        const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
        if (utilization >= 0.8) {
          dispatchAutomation("budget_threshold", {
            ...automationContext,
            agentId: agent.id,
          });
        }
      }
      const budgetLocale = db.snap.listSnapshot().locale;
      checkBudgetThreshold(
        agent,
        notify,
        (en, zh) => localizeNotification(budgetLocale, en, zh),
      );
    } catch (err) {
      deps.logger.warn(`[automation] Budget follow-up failed for agent ${run.agentId}:`, err instanceof Error ? err.message : String(err));
    }
  }
}
