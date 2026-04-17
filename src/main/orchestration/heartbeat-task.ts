/**
 * Heartbeat task title conventions.
 *
 * Heartbeat tasks are synthesized by the orchestrator when an agent wakes with
 * no actionable work; they carry the `[Heartbeat]` title prefix so the rest of
 * the system can detect them without a dedicated `kind` column.
 *
 * Centralizing the prefix here prevents drift between the writer (heartbeat
 * dispatch) and readers (automation, escalation, route filters).
 */
export const HEARTBEAT_TASK_TITLE_PREFIX = "[Heartbeat]";

export function isHeartbeatTaskTitle(title: string | null | undefined): boolean {
  return !!title && title.startsWith(HEARTBEAT_TASK_TITLE_PREFIX);
}
