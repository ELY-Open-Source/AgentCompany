import type { ReadAll } from "./helpers";

export function guardInReviewHasReviewer(readAll: ReadAll, taskId: string): void {
  const row = readAll<{ requiresUserReview: number; reportsTo: string | null }>(
    `select t.requires_user_review as requiresUserReview,
            a.reports_to as reportsTo
       from tasks t
       left join agents a on a.id = t.assignee_agent_id
      where t.id = ?`,
    taskId,
  )[0];
  if (!row) return;
  if (row.requiresUserReview === 1) return;
  if (row.reportsTo !== null) return;
  throw new Error(
    `Task ${taskId} has a top-level assignee and no reviewer: cannot enter in_review without requires_user_review=1.`,
  );
}
