export const VALID_TASK_STATUSES = new Set([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
]);

export function assertValidTaskStatus(status: string): void {
  if (!VALID_TASK_STATUSES.has(status)) {
    throw new Error(`Invalid task status: ${status}`);
  }
}

export function buildTaskStatusTransition(
  newStatus: string,
  timestamp: string,
): { sets: string[]; values: (string | null)[] } {
  const sets: string[] = ["status = ?", "updated_at = ?"];
  const values: (string | null)[] = [newStatus, timestamp];

  if (newStatus === "in_progress") {
    sets.push("started_at = COALESCE(started_at, ?)");
    values.push(timestamp);
  }
  if (newStatus === "done") {
    sets.push("completed_at = ?");
    values.push(timestamp);
  } else {
    sets.push("completed_at = NULL");
  }
  if (newStatus === "cancelled") {
    sets.push("cancelled_at = ?");
    values.push(timestamp);
  } else {
    sets.push("cancelled_at = NULL");
  }
  return { sets, values };
}
