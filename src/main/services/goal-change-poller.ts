import type { DatabaseSync } from "node:sqlite";

interface GoalState {
  title: string;
  description: string;
  status: string;
}

/** Returns a notice whenever the run's goal is rewritten or closed after the run started, once per change. */
export function createGoalChangePoller(db: DatabaseSync, goalId: string | null): () => string | null {
  if (!goalId) return () => null;
  const read = () => db.prepare("select title, description, status from goals where id = ?").get(goalId) as GoalState | undefined;
  let seen = read();
  return () => {
    const now = read();
    if (!seen || !now || (now.title === seen.title && now.description === seen.description && now.status === seen.status)) return null;
    const before = seen;
    seen = now;
    console.info(`[task-run] goal ${goalId} changed mid-run (${now.status}); notifying the session`);
    if (now.status !== before.status && now.status !== "active") {
      return `The goal for this work ("${now.title}") is now ${now.status}. Stop starting new work on it: wrap up, report what you finished, and set this task's status.`;
    }
    return `The goal for this work changed while you were working. It now reads: "${now.title}" — ${now.description} Re-check your plan against it.`;
  };
}

/** Joins mid-run notices from several sources into one follow-up, or null when none has news. */
export function combineMidRunPolls(...polls: Array<() => string | null>): () => string | null {
  return () => {
    const notices = polls.map((poll) => poll()).filter((notice): notice is string => notice !== null);
    return notices.length > 0 ? notices.join("\n\n") : null;
  };
}
