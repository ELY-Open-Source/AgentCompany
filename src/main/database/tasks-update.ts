import type { DatabaseSync } from "node:sqlite";
import type { ReadAll, Transaction } from "./helpers";
import { normalizeOptionalId, nowIso } from "./helpers";
import { guardInReviewHasReviewer } from "./task-review-guard";
import { assertValidTaskStatus, buildTaskStatusTransition } from "./task-status-rules";

type TaskUpdatePatch = {
  title: string;
  description: string;
  status: string;
  priority: string;
  projectId?: string | null;
  goalId?: string | null;
  parentId?: string | null;
  assigneeAgentId?: string | null;
  workspaceId?: string | null;
  requiresFilesystem: boolean;
};

type ReviewDocument = { id: string; title: string } & Record<string, unknown>;

type TaskReviewRequest = {
  reviewerAgentName: string;
  documents: ReviewDocument[];
};

type TaskUpdateActivity = {
  action: string;
  detail: string;
};

type ApprovalRequestInput = {
  companyId: string;
  relatedTaskId?: string | null;
  requestedByAgentId?: string | null;
  relatedAgentId?: string | null;
  type: string;
  payloadSummary: string;
  impactSummary: string;
  payloadJson?: string | null;
};

type TaskUpdateResult = {
  previousStatus: string;
  newStatus: string;
  previousAssigneeAgentId: string | null;
  newAssigneeAgentId: string | null;
  parentId: string | null;
  reviewRequested: boolean;
  statusChanged: boolean;
};

export function buildTaskUpdateMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    addComment: (input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }) => void;
    addActivity: (input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) => void;
    requestApproval: (input: ApprovalRequestInput) => string;
    setHeartbeat: (agentId: string, enabled: boolean, intervalSec: number) => void;
  },
) {
  function incrementActiveSprintVelocity(companyId: string, delta: number): void {
    const ts = nowIso();
    const today = ts.slice(0, 10);
    getDb()
      .prepare(
        "update sprints set completed_points = max(0, completed_points + ?), updated_at = ? where company_id = ? and status = 'active' and start_date <= ? and end_date >= ?",
      )
      .run(delta, ts, companyId, today, today);
  }

  function pauseAssigneeHeartbeat(agentId: string | null): void {
    if (!agentId) return;
    const agent = getDb()
      .prepare("select heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec from agents where id = ?")
      .get(agentId) as { heartbeatEnabled: number; heartbeatIntervalSec: number | null } | undefined;
    if (!agent?.heartbeatEnabled) return;
    deps.setHeartbeat(agentId, false, agent.heartbeatIntervalSec || 120);
  }

  function requestDeliverableReview(input: {
    companyId: string;
    taskId: string;
    actorAgentId: string;
    taskTitle: string;
    currentAssigneeAgentId: string | null;
    reviewRequest: TaskReviewRequest;
  }): void {
    const docTitles = input.reviewRequest.documents.map((document) => document.title).join(", ");
    deps.requestApproval({
      companyId: input.companyId,
      relatedTaskId: input.taskId,
      requestedByAgentId: input.actorAgentId,
      type: "deliverable_review",
      payloadSummary: `Review deliverable: ${docTitles || input.taskTitle}`.slice(0, 280),
      impactSummary: `${input.reviewRequest.reviewerAgentName} reviewed and approved. Awaiting your final review.`.slice(0, 400),
      payloadJson: JSON.stringify({
        documentIds: input.reviewRequest.documents.map((document) => document.id),
        documents: input.reviewRequest.documents,
      }),
    });
    getDb()
      .prepare("update tasks set requires_user_review = 0, updated_at = ? where id = ? and company_id = ?")
      .run(nowIso(), input.taskId, input.companyId);
    pauseAssigneeHeartbeat(input.currentAssigneeAgentId);
    deps.addComment({
      companyId: input.companyId,
      taskId: input.taskId,
      authorAgentId: null,
      authorName: "System",
      body: "Deliverable submitted for board review.",
    });
  }

  return {
    updateTaskWithReviewSideEffects(input: {
      taskId: string;
      companyId: string;
      actorAgentId: string;
      actorName: string;
      task: TaskUpdatePatch;
      comment?: string;
      reviewRequest?: TaskReviewRequest | null;
      activity: TaskUpdateActivity;
    }): TaskUpdateResult {
      assertValidTaskStatus(input.task.status);
      const assigneeAgentId = normalizeOptionalId(input.task.assigneeAgentId);
      if (input.task.status === "in_progress" && !assigneeAgentId) {
        throw new Error("Tasks in progress require an assignee.");
      }

      return transaction(() => {
        const current = getDb()
          .prepare(
            "select id, company_id as companyId, status, title, assignee_agent_id as assigneeAgentId, parent_id as parentId, requires_user_review as requiresUserReview from tasks where id = ? and company_id = ?",
          )
          .get(input.taskId, input.companyId) as
          | {
              id: string;
              companyId: string;
              status: string;
              title: string;
              assigneeAgentId: string | null;
              parentId: string | null;
              requiresUserReview: number;
            }
          | undefined;
        if (!current) {
          throw new Error(`Task not found: ${input.taskId}`);
        }

        const reviewRequested =
          input.task.status === "done" &&
          current.requiresUserReview === 1 &&
          input.reviewRequest !== null &&
          input.reviewRequest !== undefined;
        if (input.task.status === "done" && current.requiresUserReview === 1 && !input.reviewRequest) {
          throw new Error(`Task ${input.taskId} requires a deliverable review request before it can be marked done.`);
        }
        const newStatus = reviewRequested ? "in_review" : input.task.status;
        assertValidTaskStatus(newStatus);

        if (reviewRequested) {
          requestDeliverableReview({
            companyId: input.companyId,
            taskId: input.taskId,
            actorAgentId: input.actorAgentId,
            taskTitle: current.title,
            currentAssigneeAgentId: current.assigneeAgentId,
            reviewRequest: input.reviewRequest!,
          });
        }

        const statusChanged = current.status !== newStatus;
        if (statusChanged && newStatus === "in_review") {
          guardInReviewHasReviewer(readAll, input.taskId);
        }

        const ts = nowIso();
        const sets = [
          "project_id = ?",
          "goal_id = ?",
          "parent_id = ?",
          "title = ?",
          "description = ?",
          "assignee_agent_id = ?",
          "workspace_id = ?",
          "priority = ?",
          "requires_filesystem = ?",
        ];
        const values: Array<string | number | null> = [
          normalizeOptionalId(input.task.projectId),
          normalizeOptionalId(input.task.goalId),
          normalizeOptionalId(input.task.parentId),
          input.task.title,
          input.task.description,
          assigneeAgentId,
          normalizeOptionalId(input.task.workspaceId),
          input.task.priority,
          input.task.requiresFilesystem ? 1 : 0,
        ];
        const transition = statusChanged ? buildTaskStatusTransition(newStatus, ts) : null;
        if (transition) {
          sets.push(...transition.sets);
          values.push(...transition.values);
        } else {
          sets.push("status = ?", "updated_at = ?");
          values.push(newStatus, ts);
        }

        const updateResult = getDb()
          // eslint-disable-next-line no-restricted-syntax -- R-03 sanctioned domain update helper: SET clauses come from fixed literals only; status->phase trigger and explicit task_leases delete keep the dual-write surface coherent inside this transaction.
          .prepare(`update tasks set ${sets.join(", ")} where id = ? and company_id = ?`)
          .run(...values, input.taskId, input.companyId);
        if (updateResult.changes === 0) {
          throw new Error(`Task not found: ${input.taskId}`);
        }
        if (transition?.clearsLease) {
          getDb()
            .prepare("DELETE FROM task_leases WHERE task_id = ?")
            .run(input.taskId);
        }
        if (newStatus === "done" && current.status !== "done") {
          incrementActiveSprintVelocity(input.companyId, 1);
        }
        if (current.status === "done" && newStatus !== "done") {
          incrementActiveSprintVelocity(input.companyId, -1);
        }
        if (input.comment) {
          deps.addComment({
            companyId: input.companyId,
            taskId: input.taskId,
            authorAgentId: input.actorAgentId,
            authorName: input.actorName,
            body: input.comment,
          });
        }
        deps.addActivity({
          companyId: input.companyId,
          actor: input.actorAgentId,
          action: input.activity.action,
          entityType: "task",
          entityId: input.taskId,
          detail: input.activity.detail,
        });

        return {
          previousStatus: current.status,
          newStatus,
          previousAssigneeAgentId: current.assigneeAgentId,
          newAssigneeAgentId: assigneeAgentId,
          parentId: normalizeOptionalId(input.task.parentId),
          reviewRequested,
          statusChanged,
        };
      });
    },
  };
}
