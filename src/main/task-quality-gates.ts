/**
 * Task Quality Gates — pure validation functions for task creation.
 *
 * Called by IPC handlers, API server, and automation service to enforce
 * minimum description quality, acceptance criteria, and capability matching.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CapabilityMatchResult {
  matched: boolean;
  warning?: string;
}

/** Minimal DB interface for capability matching — keeps the function testable with mocks.
 *  Skill methods are optional since the skill system may not be implemented yet (graceful degradation per D-07). */
export interface CapabilityMatchDb {
  getAgent(id: string): { name: string; capabilities: string };
  listAgentSkillAssignments?(id: string): string[];
  getCompanySkill?(companyId: string, skillId: string): { name: string; description: string | null; slug: string } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_DESCRIPTION_LENGTH = 50;

export const ACCEPTANCE_CRITERIA_KEYWORDS: readonly string[] = [
  "acceptance criteria",
  "done when",
  "success criteria",
  "definition of done",
  "requirements:",
  "must:",
  "should:",
  "- [ ]",
  "- [x]",
  "deliverable:",
  "expected outcome",
  "exit criteria",
];

// ---------------------------------------------------------------------------
// checkAcceptanceCriteria
// ---------------------------------------------------------------------------

export function checkAcceptanceCriteria(description: string): { hasCriteria: boolean; suggestion: string } {
  const lower = description.toLowerCase();
  const found = ACCEPTANCE_CRITERIA_KEYWORDS.some((kw) => lower.includes(kw));

  if (found) {
    return { hasCriteria: true, suggestion: "" };
  }

  return {
    hasCriteria: false,
    suggestion:
      'Task description should include acceptance criteria. Add a "Done when:" or "Acceptance criteria:" section, or use checkbox items (- [ ]) to define success conditions.',
  };
}

// ---------------------------------------------------------------------------
// validateTaskCreation
// ---------------------------------------------------------------------------

export function validateTaskCreation(
  input: { title: string; description: string },
  isHeartbeat: boolean,
): TaskValidationResult {
  // Heartbeat tasks bypass all validation
  if (isHeartbeat) {
    return { valid: true, errors: [], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // TASK-01: Minimum description length
  if (input.description.length < MIN_DESCRIPTION_LENGTH) {
    errors.push(
      `Task description must be at least ${MIN_DESCRIPTION_LENGTH} characters (currently ${input.description.length}). Add details about what needs to be done, expected behavior, and any constraints.`,
    );
  }

  // TASK-02: Acceptance criteria detection (only check if length passes)
  if (input.description.length >= MIN_DESCRIPTION_LENGTH) {
    const criteria = checkAcceptanceCriteria(input.description);
    if (!criteria.hasCriteria) {
      errors.push(criteria.suggestion);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// checkCapabilityMatch
// ---------------------------------------------------------------------------

/** Tokenize text into words >3 chars, same pattern as database.ts autoAssignTask */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
}

export function checkCapabilityMatch(
  db: CapabilityMatchDb,
  agentId: string,
  taskDescription: string,
  companyId: string,
): CapabilityMatchResult {
  const taskWords = tokenize(taskDescription);

  // Nothing to match against — task description too short/vague
  if (taskWords.length === 0) {
    return { matched: true };
  }

  const agent = db.getAgent(agentId);
  const capWords = tokenize(agent.capabilities);
  const capabilityOverlap = taskWords.filter((w) => capWords.includes(w)).length;

  // Check skill assignments for additional matching (graceful degradation)
  let skillOverlap = 0;
  try {
    if (db.listAgentSkillAssignments && db.getCompanySkill) {
      const skillIds = db.listAgentSkillAssignments(agentId);
      for (const skillId of skillIds) {
        const skill = db.getCompanySkill(companyId, skillId);
        if (skill) {
          const skillWords = tokenize(`${skill.name} ${skill.description ?? ""} ${skill.slug}`);
          skillOverlap += taskWords.filter((w) => skillWords.includes(w)).length;
        }
      }
    }
  } catch {
    // Skill system may not be available — graceful degradation per D-07
  }

  // Direct capability or skill overlap found
  if (capabilityOverlap > 0 || skillOverlap > 0) {
    return { matched: true };
  }

  // No capabilities defined at all — graceful degradation (Pitfall 4)
  if (capWords.length === 0 && skillOverlap === 0) {
    return { matched: true };
  }

  // Agent has capabilities but no overlap — warn
  return {
    matched: false,
    warning: `Agent "${agent.name}" may lack skills for this task. Their capabilities (${agent.capabilities.slice(0, 80)}...) have no overlap with the task description. Consider reassigning.`,
  };
}

// ---------------------------------------------------------------------------
// TASK-04: Stale Review Escalation
// ---------------------------------------------------------------------------

export const REVIEW_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (D-08)

export interface SweepStaleReviewsDeps {
  db: {
    queryAll: <T>(sql: string, ...params: unknown[]) => T[];
    getManagerForAgent: (agentId: string) => { id: string; name: string; companyId: string } | null;
    getChainOfCommand: (agentId: string) => Array<{ id: string; name: string }>;
    advanceTaskStatus: (taskId: string, newStatus: string, comment?: string) => { previousStatus: string };
  };
  dispatchAgentMessage: (
    deps: {
      db: SweepStaleReviewsDeps["db"];
      emitEvent: (...args: unknown[]) => void;
      publishDomainChanged: () => void;
      wakeAgentIfPossible: (agentId: string, companyId: string, trigger: string) => void;
    },
    message: {
      companyId: string;
      fromAgentId: string;
      toAgentId: string | null;
      channel: string;
      subject: string;
      body: string;
      priority: string;
    },
    wakeTrigger: string,
  ) => { ok: boolean };
  resolveApprovalDecision: (params: {
    db: SweepStaleReviewsDeps["db"];
    handleApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
    companyId: string;
    approvalId: string;
    state: "approved" | "rejected" | "revision_requested";
    decisionNote?: string;
    detail?: string | null;
    actor?: string;
  }) => void;
  notify: (options: {
    title: string;
    body: string;
    urgency?: string;
    navigation?: { section: string; entityId?: string };
    batchKey?: string;
  }) => void;
  handleTaskStatusChange: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => void;
  handleApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
  emitEvent: (...args: unknown[]) => void;
  publishDomainChanged: () => void;
  wakeAgentIfPossible: (agentId: string, companyId: string, trigger: string) => void;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export function sweepStaleReviews(
  companyId: string,
  deps: SweepStaleReviewsDeps,
  now: number = Date.now(),
): number {
  let escalatedCount = 0;
  const reviewTasks = deps.db.queryAll<{
    id: string;
    assigneeAgentId: string | null;
    updatedAt: string;
    title: string;
  }>(
    `SELECT id, assignee_agent_id as assigneeAgentId, updated_at as updatedAt, title
     FROM tasks
     WHERE company_id = ? AND status = 'in_review'`,
    companyId,
  );

  for (const task of reviewTasks) {
    const reviewAge = now - new Date(task.updatedAt).getTime();
    if (reviewAge < REVIEW_TIMEOUT_MS) continue;
    if (!task.assigneeAgentId) continue;

    // The reviewer is the assignee's direct manager
    const reviewer = deps.db.getManagerForAgent(task.assigneeAgentId);
    if (!reviewer) continue; // No manager = CEO-assigned task, skip escalation

    // D-09: Escalate to the reviewer's manager (manager's manager)
    const chain = deps.db.getChainOfCommand(reviewer.id);
    const escalationTarget = chain.length > 0 ? chain[0] : null;

    if (escalationTarget) {
      deps.dispatchAgentMessage(
        {
          db: deps.db,
          emitEvent: deps.emitEvent,
          publishDomainChanged: deps.publishDomainChanged,
          wakeAgentIfPossible: deps.wakeAgentIfPossible,
        },
        {
          companyId,
          fromAgentId: reviewer.id,
          toAgentId: escalationTarget.id,
          channel: "direct",
          subject: `Review timeout: ${task.title}`,
          body: `Review by ${reviewer.name} on "${task.title}" has been pending for over 30 minutes. Auto-escalating.`,
          priority: "urgent",
        },
        "subtask_completed",
      );
    } else {
      // D-09: No higher manager (reviewer is CEO) -- notify human
      deps.notify({
        title: "Review Timeout",
        body: `"${task.title}" review has been pending over 30 minutes. Auto-approving.`,
        urgency: "critical",
        navigation: { section: "tasks", entityId: task.id },
        batchKey: "review_escalation",
      });
    }

    // D-10: Auto-approve any pending approval linked to this task
    const pendingApprovals = deps.db.queryAll<{ id: string }>(
      `SELECT id FROM approvals
       WHERE company_id = ? AND related_task_id = ? AND state = 'pending'
       LIMIT 1`,
      companyId,
      task.id,
    );
    for (const approval of pendingApprovals) {
      try {
        deps.resolveApprovalDecision({
          db: deps.db,
          handleApprovalResolved: deps.handleApprovalResolved,
          companyId,
          approvalId: approval.id,
          state: "approved",
          decisionNote: "Auto-approved: review timeout exceeded 30 minutes.",
          detail: "Auto-approved by review timeout escalation",
          actor: "system",
        });
      } catch {
        // Already decided (race condition with manual approval) -- skip silently (Pitfall 3)
      }
    }

    // D-10: Advance task status from in_review to done
    try {
      deps.db.advanceTaskStatus(task.id, "done", "Auto-advanced: review timeout exceeded 30 minutes.");
      deps.handleTaskStatusChange(task.id, companyId, "in_review", "done");
    } catch {
      // Task may have been updated by manual action
    }

    escalatedCount++;
  }

  return escalatedCount;
}
