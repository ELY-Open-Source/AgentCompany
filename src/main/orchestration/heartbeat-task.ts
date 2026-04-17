/**
 * Heartbeat task title conventions.
 *
 * Heartbeat tasks are synthesized by the orchestrator when an agent wakes with
 * no actionable work. The `tasks.is_heartbeat` column is the authoritative
 * flag; the `[Heartbeat]` title prefix remains only for human-readable display
 * so existing runs, logs, and UI affordances stay stable.
 */
export const HEARTBEAT_TASK_TITLE_PREFIX = "[Heartbeat]";
