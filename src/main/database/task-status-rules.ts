export const VALID_TASK_STATUSES = new Set([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
]);

const STATUSES_THAT_CLEAR_LEASE = new Set<string>([
  "done",
  "cancelled",
  "blocked",
  "todo",
  "backlog",
]);

export function assertValidTaskStatus(status: string): void {
  if (!VALID_TASK_STATUSES.has(status)) {
    throw new Error(`Invalid task status: ${status}`);
  }
}

export function buildTaskStatusTransition(
  newStatus: string,
  timestamp: string,
): { sets: string[]; values: (string | null)[]; clearsLease: boolean } {
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
  if (newStatus !== "in_progress") {
    sets.push("checkout_run_id = NULL");
  }
  if (newStatus === "todo" || newStatus === "backlog") {
    sets.push("active_run_id = NULL");
  }

  return {
    sets,
    values,
    clearsLease: STATUSES_THAT_CLEAR_LEASE.has(newStatus),
  };
}
